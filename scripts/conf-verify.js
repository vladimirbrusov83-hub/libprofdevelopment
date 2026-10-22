// Stage C — check every claim in extract.json against the saved page text, with
// no model involved. Passing claims become ops for conf-apply.js (still the only
// writer); everything else goes to a review list for Sonnet or a human.
//
//   node scripts/conf-verify.js --ids 31,40,107     # or no --ids = every extract on disk
//
// Writes scripts/conf-updates.json (ops) and scripts/pages/review.json.

const fs = require("fs");
const path = require("path");
const { parse } = require("./conf-lib");
const { PAGES, norm, quoteHasDate, context, DEADLINE_TYPES, readManifest, pageDir, loadPages } = require("./conf-pages");

const argv = process.argv.slice(2);
const TODAY = new Date().toISOString().slice(0, 10);
const manifest = readManifest();
const list = parse();
const byId = new Map(list.map(c => [c.id, c]));
const ids = argv.includes("--ids")
  ? argv[argv.indexOf("--ids") + 1].split(",").map(Number)
  : Object.keys(manifest).map(Number);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Human date string in the page's house style: "March 21–24, 2027",
// "October 30–November 1, 2026", "December 9, 2026".
function displayDates(start, end) {
  const [y1, m1, d1] = start.split("-").map(Number);
  if (!end || end === start) return `${MONTH_NAMES[m1 - 1]} ${d1}, ${y1}`;
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y1 !== y2) return `${MONTH_NAMES[m1 - 1]} ${d1}, ${y1}–${MONTH_NAMES[m2 - 1]} ${d2}, ${y2}`;
  if (m1 !== m2) return `${MONTH_NAMES[m1 - 1]} ${d1}–${MONTH_NAMES[m2 - 1]} ${d2}, ${y1}`;
  return `${MONTH_NAMES[m1 - 1]} ${d1}–${d2}, ${y1}`;
}

// A quote must be on the page it cites (or, failing that, any saved page).
function quoteOnPage(pages, claim) {
  const q = norm(claim.quote);
  if (q.length < 6) return null;
  const cited = pages.find(p => p.n === claim.page);
  if (cited && norm(cited.text).includes(q)) return cited;
  return pages.find(p => norm(p.text).includes(q)) || null;
}

const ops = [];
const review = [];
const evidence = {};

for (const id of ids) {
  const c = byId.get(id);
  const m = manifest[id];
  if (!c || !m) continue;
  if (m.verdict !== "ok") {
    ops.push({ id, outcome: m.verdict, note: `${m.pages[0].status || m.pages[0].error || "no response"} from ${m.pages[0].url}` });
    continue;
  }
  const file = path.join(pageDir(id), "extract.json");
  if (!fs.existsSync(file)) continue;
  const x = JSON.parse(fs.readFileSync(file, "utf8"));
  const pages = loadPages(id);
  const problems = [];
  const set = {};
  const ev = [];

  // ── edition
  let eventEnd = c.dateEnd || c.dateSort;
  if (x.status === "found" && x.edition) {
    const e = x.edition;
    const pg = quoteOnPage(pages, e);
    const datesOk = ISO.test(e.start) && (!e.end || (ISO.test(e.end) && e.end >= e.start));
    if (!pg) problems.push(`edition quote not on any saved page: "${e.quote}"`);
    else if (!datesOk) problems.push(`edition dates malformed: ${e.start}..${e.end}`);
    else if (!quoteHasDate(e.quote, e.start) || (e.end && !quoteHasDate(e.quote, e.end))) problems.push(`edition quote doesn't state ${e.start}${e.end ? "–" + e.end : ""}: "${e.quote}"`);
    else if ((e.end || e.start) < TODAY) problems.push(`edition already ended (${e.end || e.start})`);
    else {
      eventEnd = e.end || e.start;
      ev.push({ field: "dates", quote: e.quote, url: pg.url });
      if (e.start !== c.dateSort || (e.end || undefined) !== (c.dateEnd || undefined)) {
        set.dates = displayDates(e.start, e.end);
        set.dateSort = e.start;
        if (e.end && e.end !== e.start) set.dateEnd = e.end;
        // Rolling forward to a new year renames "Foo 2026" → "Foo 2027".
        const oldY = c.dateSort.slice(0, 4), newY = e.start.slice(0, 4);
        if (oldY !== newY && c.name.includes(oldY)) set.name = c.name.split(oldY).join(newY);
        // Location and format aren't proven by a date quote: flag, don't auto-apply.
        if (norm(e.location) !== norm(c.location) || e.format !== c.format) {
          review.push({ id, name: c.name, kind: "check", issue: `new edition — confirm location/format: "${e.location}" (${e.format}) vs listed "${c.location}" (${c.format})`, url: pg.url });
        }
      }
    }
  }

  // ── deadlines
  const good = [];
  for (const d of x.deadlines || []) {
    const t = DEADLINE_TYPES[d.type];
    const pg = quoteOnPage(pages, d);
    const why =
      !t ? `unknown type ${d.type}` :
      !ISO.test(d.date) ? `bad date ${d.date}` :
      !pg ? `quote not on any saved page` :
      !quoteHasDate(d.quote, d.date) ? `quote doesn't state ${d.date}` :
      !t.words.test(context(pg.text, d.quote)) ? `the quote's line doesn't support type ${d.type} (needs ${t.words})` :
      d.date < TODAY ? `already past` :
      d.date > eventEnd ? `after the event ends (${eventEnd})` : null;
    if (why) {
      if (why !== "already past") problems.push(`${d.type} ${d.date}: ${why} — "${d.quote}"`);
      continue;
    }
    // Use the model's short label (page's own words) only if every real word of it
    // is on the page near the quote; otherwise the fixed label for the type.
    const ctx = context(pg.text, d.quote);
    const words = norm(d.label || "").split(/[^a-z0-9]+/).filter(w => w.length > 3);
    // Labels with dates, numbers or sales talk ("Register by Feb 12 & SAVE") fall back too.
    const clean = d.label && !/\d|&|!|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(d.label)
      && /\b(due|ends|closes|deadline)$/i.test(d.label.trim()) && d.label.length <= 40;
    const what = clean && words.length && words.every(w => ctx.includes(w))
      ? d.label.trim().charAt(0).toUpperCase() + d.label.trim().slice(1) : t.what;
    // One entry per date: two labels for the same day is noise on the card.
    if (!good.some(g => g.date === d.date)) {
      good.push({ date: d.date, what });
      ev.push({ field: d.type, date: d.date, quote: d.quote, url: pg.url });
    }
  }
  good.sort((a, b) => a.date < b.date ? -1 : 1);
  const current = (c.deadlines || []).filter(d => d.date >= TODAY);
  if (good.length) {
    if (JSON.stringify(good) !== JSON.stringify(current)) set.deadlines = good;
  } else if (current.length) {
    // Never silently wipe a listed deadline because the model didn't find it.
    review.push({ id, name: c.name, kind: "check", issue: `listed deadline(s) not confirmed on saved pages: ${current.map(d => `${d.what} ${d.date}`).join("; ")}`, url: c.url });
  }

  // ── AI focus: suggest only, never auto-change
  if (x.ai && pages.length && quoteOnPage(pages, x.ai) && x.ai.level !== c.aiFocus && !(c.aiFocus === "ai100" && x.ai.level === "aibig")) {
    review.push({ id, name: c.name, kind: "ai", issue: `page suggests ${x.ai.level} (listed ${c.aiFocus}): "${x.ai.quote}"` });
  }

  if (problems.length) review.push({ id, name: c.name, kind: "failed", model: x.model, issue: problems });

  const sources = [...new Set(ev.map(e => e.url))];
  evidence[id] = { checkedAt: TODAY, model: x.model, sources, claims: ev };
  if (x.status === "no-future-edition" && !Object.keys(set).length) {
    ops.push({ id, outcome: "no-future-edition", note: "verified pipeline: no next edition on saved pages" });
  } else if (Object.keys(set).length) {
    ops.push({ id, set, outcome: "resolved", note: ev.map(e => `${e.field}: "${e.quote}"`).join(" | ").slice(0, 400), sources });
  } else if (x.status === "found" && !problems.length) {
    ops.push({ id, outcome: "resolved", note: "verified pipeline: no change", sources });
  }
}

fs.writeFileSync(path.join(__dirname, "conf-updates.json"), JSON.stringify(ops, null, 2));
fs.writeFileSync(path.join(PAGES, "review.json"), JSON.stringify(review, null, 2));
fs.writeFileSync(path.join(PAGES, "evidence.json"), JSON.stringify({ ...(fs.existsSync(path.join(PAGES, "evidence.json")) ? JSON.parse(fs.readFileSync(path.join(PAGES, "evidence.json"), "utf8")) : {}), ...evidence }, null, 2));

const changed = ops.filter(o => o.set);
console.log(`${ops.length} ops (${changed.length} with changes) → scripts/conf-updates.json`);
for (const o of changed) console.log(`  #${o.id} ${byId.get(o.id).name.slice(0, 40)}: ${Object.entries(o.set).map(([k, v]) => k === "deadlines" ? "deadlines=" + v.map(d => `${d.what} ${d.date}`).join("; ") : `${k}=${v}`).join(" · ")}`);
const failed = review.filter(r => r.kind === "failed");
console.log(`${review.length} for review (${failed.length} failed checks${failed.length ? ": #" + failed.map(r => r.id).join(", #") : ""}) → scripts/pages/review.json`);
