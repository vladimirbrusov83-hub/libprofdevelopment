// Approval page for a refresh run: every proposed change next to the line of the
// organizer's page it came from, with a checkbox. Approved ops are written to
// scripts/conf-approved.json; conf-apply.js stays the only thing that writes
// index.html (the page runs it --dry first, then for real on a second click).
//
//   node scripts/conf-report.js                  # reads scripts/conf-updates.json
//   node scripts/conf-report.js --file x.json    # another ops file
//   node scripts/conf-report.js --no-open        # don't open the browser
//
// Local only: listens on 127.0.0.1, lives under scripts/ (kept off the site).

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");
const { parse } = require("./conf-lib");
const { PAGES, norm, loadPages } = require("./conf-pages");

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const FILE = path.resolve(opt("--file", path.join(__dirname, "conf-updates.json")));
const OUT = path.join(__dirname, "conf-approved.json");
const PORT = Number(opt("--port", 8790));
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

// Fields that only make sense together: a new edition's dates, name and cleared
// status note are one decision; so are a new city and its format.
const EDITION = ["dates", "dateSort", "dateEnd", "name", "deadline"];
const PLACE = ["location", "format"];
const fmtDl = d => `${d.what} · ${d.date}`;

// The page line(s) holding a quote, in the page's own wording and case. Same
// search as conf-pages.context(), which returns normalized text instead.
function rawLine(id, url, quote) {
  const pages = loadPages(id);
  const q = norm(quote);
  const order = [...pages.filter(p => p.url === url), ...pages.filter(p => p.url !== url)];
  for (const p of order) {
    const lines = p.text.split("\n");
    for (let span = 1; span <= 4; span++)
      for (let i = 0; i + span <= lines.length; i++)
        if (norm(lines.slice(i, i + span).join(" ")).includes(q)) return { line: lines.slice(i, i + span).join("\n"), url: p.url };
  }
  return { line: null, url };
}

function build() {
  const ops = readJson(FILE, []);
  const review = readJson(path.join(PAGES, "review.json"), []);
  const evidence = readJson(path.join(PAGES, "evidence.json"), {});
  const byId = new Map(parse().map(c => [c.id, c]));
  const cards = [], quiet = [], ai = [], failed = [];

  ops.forEach((op, i) => {
    const c = byId.get(op.id);
    if (!c) return;
    if (!op.set) {
      quiet.push({ i, id: op.id, name: c.name, outcome: op.outcome || "note", note: op.note || "" });
      return;
    }
    const claims = (evidence[op.id] && evidence[op.id].claims) || [];
    const withLine = cl => ({ quote: cl.quote, ...rawLine(op.id, cl.url, cl.quote) });
    const groups = [];
    const rowsFor = keys => keys.filter(k => k in op.set).map(k => ({ field: k, before: c[k] ?? null, after: op.set[k] }));
    const add = (gid, label, rows, cls) => {
      if (!rows.length) return;
      groups.push({ gid, label, rows, live: rows.every(r => JSON.stringify(r.before) === JSON.stringify(r.after)), claims: cls });
    };
    add("edition", "Dates / edition", rowsFor(EDITION), claims.filter(x => x.field === "dates").map(withLine));
    add("place", "Location / format", rowsFor(PLACE), claims.filter(x => x.field === "dates" || x.field === "location").map(withLine));
    const other = Object.keys(op.set).filter(k => !EDITION.includes(k) && !PLACE.includes(k) && k !== "deadlines");
    add("other", "Other fields", rowsFor(other), []);
    let removed = [];
    if (op.set.deadlines) {
      const now = c.deadlines || [];
      for (const d of op.set.deadlines) {
        const same = now.find(n => n.date === d.date);
        groups.push({
          gid: "dl:" + d.date, label: "Deadline", deadline: d,
          // A deadline after the listed event ends belongs to the new edition.
          needsEdition: "dateSort" in op.set && d.date > (c.dateEnd || c.dateSort),
          rows: [{ field: "deadline", before: same ? fmtDl(same) : null, after: fmtDl(d) }],
          live: !!same && same.what === d.what,
          claims: claims.filter(x => x.date === d.date).map(withLine)
        });
      }
      removed = now.filter(n => !op.set.deadlines.some(d => d.date === n.date));
    }
    const flags = review.filter(r => r.id === op.id && r.kind === "check").map(r => r.issue);
    cards.push({ i, id: op.id, name: c.name, url: c.url, description: c.description, groups, current: c.deadlines || [], removed, flags });
  });

  for (const r of review) {
    const c = byId.get(r.id);
    if (r.kind === "ai") {
      const m = String(r.issue).match(/suggests (\w+) \(listed (\w+)\): "([\s\S]*)"$/);
      if (m) ai.push({ id: r.id, name: c ? c.name : r.name, to: m[1], from: m[2], quote: m[3], url: c && c.url });
    } else if (r.kind === "failed") {
      const issues = [].concat(r.issue).map(s => {
        const q = String(s).match(/— "([\s\S]*)"$/);
        return { text: s, ...(q ? rawLine(r.id, null, q[1]) : {}) , quote: q ? q[1] : null };
      });
      failed.push({ id: r.id, name: c ? c.name : r.name, model: r.model, url: c && c.url, issues });
    }
  }
  // Review-only "check" notes on entries with no proposed change (e.g. a listed
  // deadline the run couldn't re-confirm) still need eyes.
  const orphan = review.filter(r => r.kind === "check" && !cards.some(k => k.id === r.id))
    .map(r => ({ id: r.id, name: byId.get(r.id) ? byId.get(r.id).name : r.name, url: r.url, issue: r.issue }));

  const rel = path.relative(path.join(__dirname, ".."), FILE);
  return { file: rel.startsWith("..") ? path.basename(FILE) : rel, ops, cards, quiet, ai, failed, orphan };
}

// Rebuild ops from the original file and the clicks — the browser never sends
// field values, so nothing it does can put an unreviewed value into the page.
function approvedOps(data, picks) {
  const out = [];
  for (const card of data.cards) {
    const op = data.ops[card.i];
    const chosen = new Set(picks.groups[card.i] || []);
    const set = {};
    for (const g of card.groups) {
      if (!chosen.has(g.gid) || g.gid.startsWith("dl:")) continue;
      for (const r of g.rows) set[r.field] = op.set[r.field];
    }
    // Deadlines: start from what's listed and change only what was ticked; an
    // unticked relabel keeps the listed one. Listed dates the run didn't find go
    // only when some deadline was approved (what the page says).
    const dls = card.groups.filter(g => g.gid.startsWith("dl:") && chosen.has(g.gid) && (!g.needsEdition || chosen.has("edition"))).map(g => g.deadline);
    if (dls.length) {
      const gone = new Set(card.removed.map(d => d.date));
      const keep = card.current.filter(d => !gone.has(d.date) && !dls.some(n => n.date === d.date));
      set.deadlines = [...keep, ...dls].sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    if (!Object.keys(set).length) continue;
    out.push({ ...op, set });
  }
  for (const q of data.quiet) if ((picks.quiet || []).includes(q.i)) out.push(data.ops[q.i]);
  for (const a of data.ai) if ((picks.ai || []).includes(a.id)) out.push({ id: a.id, set: { aiFocus: a.to } });
  return out;
}

const run = args => new Promise(res =>
  execFile(process.execPath, [path.join(__dirname, "conf-apply.js"), OUT, ...args], { cwd: path.join(__dirname, "..") },
    (err, stdout, stderr) => res({ ok: !err, output: (stdout + stderr).trim() })));

const body = req => new Promise(res => { let s = ""; req.on("data", d => (s += d)); req.on("end", () => res(s ? JSON.parse(s) : {})); });
const send = (res, code, type, s) => { res.writeHead(code, { "content-type": type }); res.end(s); };

let current = build();
let savedCount = null;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      current = build();
      const json = JSON.stringify(current).replace(/</g, "\\u003c");
      return send(res, 200, "text/html; charset=utf-8", PAGE.replace("__DATA__", json));
    }
    if (req.method === "POST" && req.url === "/save") {
      const ops = approvedOps(current, await body(req));
      fs.writeFileSync(OUT, JSON.stringify(ops, null, 2));
      savedCount = ops.length;
      const dry = await run(["--dry"]);
      return send(res, 200, "application/json", JSON.stringify({ count: ops.length, ...dry }));
    }
    if (req.method === "POST" && req.url === "/apply") {
      if (savedCount == null) return send(res, 400, "application/json", JSON.stringify({ ok: false, output: "Save first." }));
      const footer = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const r = await run(["--footer", footer]);
      savedCount = null;
      return send(res, 200, "application/json", JSON.stringify(r));
    }
    send(res, 404, "text/plain", "not found");
  } catch (e) {
    send(res, 500, "application/json", JSON.stringify({ ok: false, output: String(e.stack || e) }));
  }
});

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve Refresh</title>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root { --navy:#0b2545; --navy-2:#13315c; --gold:#c9a227; --ink:#1d2433; --muted:#5b6475; --line:#d9dee7; --bg:#f4f6f9; --card:#fff;
  --add:#e6f4ea; --add-ink:#1e6b34; --del:#fbeaea; --del-ink:#9b2c2c; --warn:#fff6db; --warn-ink:#7a5a00; --mark:#ffe58a; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 "Public Sans",system-ui,sans-serif; }
header { background:var(--navy); color:#fff; padding:18px 16px; border-bottom:3px solid var(--gold); }
header .in, main { max-width:980px; margin:0 auto; }
h1 { margin:0; font-size:22px; } header p { margin:4px 0 0; color:#c8d3e6; font-size:14px; }
main { padding:16px 16px 120px; }
h2 { font-size:17px; margin:28px 0 10px; color:var(--navy-2); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
h2 .n { background:var(--navy-2); color:#fff; border-radius:10px; padding:0 8px; font-size:13px; }
.hint { color:var(--muted); font-size:14px; margin:-4px 0 12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:6px; padding:14px; margin-bottom:12px; }
.card h3 { margin:0 0 2px; font-size:16px; } .card h3 a { color:var(--navy-2); }
.meta { color:var(--muted); font-size:13px; }
.flag { background:var(--warn); color:var(--warn-ink); border-radius:4px; padding:6px 10px; margin:8px 0 0; font-size:13.5px; }
.group { border-top:1px solid var(--line); margin-top:12px; padding-top:10px; }
.group label.pick { display:flex; gap:10px; align-items:flex-start; cursor:pointer; }
.group input[type=checkbox] { width:20px; height:20px; margin:2px 0 0; accent-color:var(--navy-2); flex:none; }
.glabel { font-weight:600; font-size:14px; }
.live { font-size:12px; color:var(--muted); font-weight:500; margin-left:6px; }
table.diff { border-collapse:collapse; margin:6px 0 0 30px; font-size:14px; width:calc(100% - 30px); }
table.diff td { padding:3px 6px; vertical-align:top; }
table.diff td.f { color:var(--muted); width:90px; font-size:12.5px; }
.b { background:var(--del); color:var(--del-ink); text-decoration:line-through; border-radius:3px; padding:0 4px; }
.a { background:var(--add); color:var(--add-ink); border-radius:3px; padding:0 4px; font-weight:500; }
.same { color:var(--muted); }
.ev { margin:8px 0 0 30px; border-left:3px solid var(--gold); background:#fbfaf4; padding:6px 10px; font-size:13.5px; white-space:pre-wrap; word-break:break-word; }
.ev mark { background:var(--mark); padding:0 1px; }
.ev .src { display:block; margin-top:4px; font-size:12px; white-space:normal; }
.ev.miss { border-left-color:var(--del-ink); background:var(--del); }
.removed { margin:10px 0 0; font-size:13.5px; color:var(--del-ink); }
.bar { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 12px; }
button { font:inherit; border-radius:4px; border:1px solid var(--navy-2); background:#fff; color:var(--navy-2); padding:7px 14px; cursor:pointer; font-weight:600; }
button.primary { background:var(--navy-2); color:#fff; } button.gold { background:var(--gold); border-color:var(--gold); color:var(--navy); }
button:disabled { opacity:.45; cursor:default; }
details { background:var(--card); border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-bottom:10px; }
details summary { cursor:pointer; font-weight:600; }
.qrow { display:flex; gap:10px; align-items:flex-start; padding:5px 0; border-top:1px solid var(--line); font-size:14px; }
.qrow:first-of-type { border-top:0; } .qrow input { width:18px; height:18px; flex:none; margin-top:2px; }
.qrow .meta { display:block; }
.empty { color:var(--muted); font-style:italic; }
.dock { position:fixed; left:0; right:0; bottom:0; background:#fff; border-top:2px solid var(--gold); box-shadow:0 -4px 16px rgba(11,37,69,.12); }
.dock .in { max-width:980px; margin:0 auto; padding:10px 16px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.dock .sum { flex:1; min-width:180px; font-size:14px; }
pre.out { background:#0f1b2d; color:#dfe7f3; padding:12px; border-radius:6px; font-size:12.5px; white-space:pre-wrap; max-height:45vh; overflow:auto; }
pre.out.bad { border:2px solid var(--del-ink); }
a { color:var(--navy-2); }
@media (max-width:600px) { table.diff, .ev { margin-left:0; width:100%; } table.diff td.f { width:70px; } }
</style></head>
<body>
<header><div class="in"><h1>Approve refresh</h1><p id="sub"></p></div></header>
<main>
  <div id="changes"></div>
  <div id="ai"></div>
  <div id="quiet"></div>
  <div id="needs"></div>
  <div id="result"></div>
</main>
<div class="dock"><div class="in">
  <span class="sum" id="sum"></span>
  <button class="primary" id="save">Save approvals &amp; preview</button>
  <button class="gold" id="apply" disabled>Apply to site file</button>
</div></div>
<script>
const D = __DATA__;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const show = v => v === null || v === undefined || v === "" ? "—" : esc(typeof v === "string" ? v : JSON.stringify(v));
const OUTCOME = { resolved: "Checked, nothing to change", "no-future-edition": "No next edition announced yet", blocked: "Site blocked the download", "not-found": "Page not found", note: "Note only" };
const AIL = { ai100: "100% AI focus", aibig: "Major AI track", aisig: "AI varies" };

// Highlight the quote inside its page line. Words are matched loosely (any
// whitespace or table pipes between them) since the line keeps the page's layout.
function mark(line, quote) {
  const words = quote.trim().split(/\s+/).map(w => w.replace(/[.*+?^$()[\]{}|\\]/g, "\\$&").replace(/[-–—]/g, "[-–—]"));
  const html = esc(line);
  try {
    const re = new RegExp(words.map(w => esc(w)).join("[\\s|]+"), "i");
    const m = html.match(re);
    if (m) return html.slice(0, m.index) + "<mark>" + m[0] + "</mark>" + html.slice(m.index + m[0].length);
  } catch (e) {}
  return html;
}
function frag(url, quote) {
  const first = quote.split("\n")[0].trim().split(/\s+/).slice(0, 8).join(" ");
  return url + "#:~:text=" + encodeURIComponent(first);
}
function evidence(cl) {
  if (!cl.line) return '<div class="ev miss">Quote not found in the saved page text: “' + esc(cl.quote) + '”</div>';
  return '<div class="ev">' + mark(cl.line, cl.quote) + '<a class="src" target="_blank" rel="noopener" href="' + esc(frag(cl.url, cl.quote)) + '">' + esc(cl.url) + ' ↗</a></div>';
}

$("#sub").textContent = D.file + " · " + D.cards.length + " entries with changes · " + D.quiet.length + " checks with nothing to change · " + (D.ai.length + D.failed.length + D.orphan.length) + " notes for you";

// ── proposed changes
let h = '<h2>Proposed changes <span class="n">' + D.cards.length + '</span></h2>';
if (D.cards.length) {
  h += '<p class="hint">Nothing here is approved until you tick it. Yellow notes mean look twice.</p>';
  h += '<div class="bar"><button id="all-clean">Approve every change without a yellow note</button><button id="none">Clear all</button></div>';
} else h += '<p class="empty">No changes proposed in this run.</p>';
for (const c of D.cards) {
  h += '<div class="card" data-card="' + c.i + '"><h3>#' + c.id + ' <a target="_blank" rel="noopener" href="' + esc(c.url) + '">' + esc(c.name) + '</a></h3>';
  for (const f of c.flags) h += '<div class="flag">⚠ ' + esc(f) + '</div>';
  for (const g of c.groups) {
    h += '<div class="group"><label class="pick"><input type="checkbox" data-op="' + c.i + '" data-gid="' + esc(g.gid) + '"' + (c.flags.length ? ' data-flag' : '') + (g.needsEdition ? ' data-needs-edition' : '') + '><span><span class="glabel">' + esc(g.label) + '</span>' + (g.live ? '<span class="live">already on the site</span>' : '') + (g.needsEdition ? '<span class="live">comes with the new dates</span>' : '') + '</span></label>';
    h += '<table class="diff">';
    for (const r of g.rows) {
      const same = JSON.stringify(r.before) === JSON.stringify(r.after);
      h += '<tr><td class="f">' + esc(r.field) + '</td><td>' + (same ? '<span class="same">' + show(r.after) + '</span>' : (r.before == null ? '' : '<span class="b">' + show(r.before) + '</span> → ') + '<span class="a">' + show(r.after) + '</span>') + '</td></tr>';
    }
    h += '</table>';
    for (const cl of g.claims) h += evidence(cl);
    if (!g.claims.length && g.gid !== "other") h += '<div class="ev miss">No saved quote for this change.</div>';
    h += '</div>';
  }
  if (c.removed.length) h += '<p class="removed">If any deadline above is approved, these listed deadlines go away (not found on the page): ' + c.removed.map(d => esc(d.what + " · " + d.date)).join("; ") + '</p>';
  if (c.flags.some(f => /description/.test(f))) h += '<p class="meta">Current description: ' + esc(c.description) + '</p>';
  h += '</div>';
}
$("#changes").innerHTML = h;

// ── AI focus suggestions
if (D.ai.length) {
  h = '<h2>AI focus suggestions <span class="n">' + D.ai.length + '</span></h2><p class="hint">The page mentions AI more than the label says. Tick to change the label (not counted as a site check).</p>';
  for (const a of D.ai) h += '<div class="card"><label class="pick qrow" style="border:0"><input type="checkbox" data-ai="' + a.id + '"><span><b>#' + a.id + ' ' + esc(a.name) + '</b><span class="meta"><span class="b">' + AIL[a.from] + '</span> → <span class="a">' + AIL[a.to] + '</span></span></span></label><div class="ev">' + esc(a.quote) + (a.url ? '<a class="src" target="_blank" rel="noopener" href="' + esc(frag(a.url, a.quote)) + '">' + esc(a.url) + ' ↗</a>' : '') + '</div></div>';
  $("#ai").innerHTML = h;
}

// ── outcome-only checks
if (D.quiet.length) {
  const by = {};
  for (const q of D.quiet) (by[q.outcome] = by[q.outcome] || []).push(q);
  h = '<h2>Checks with nothing to change <span class="n">' + D.quiet.length + '</span></h2><p class="hint">Pre-ticked. These only record the check, so the next run skips them. Only “checked” and “no next edition” put a Checked date on the card.</p>';
  for (const [k, list] of Object.entries(by)) {
    h += '<details><summary>' + esc(OUTCOME[k] || k) + ' (' + list.length + ')</summary>';
    for (const q of list) h += '<label class="qrow"><input type="checkbox" checked data-quiet="' + q.i + '"><span>#' + q.id + ' ' + esc(q.name) + '<span class="meta">' + esc(q.note) + '</span></span></label>';
    h += '</details>';
  }
  $("#quiet").innerHTML = h;
}

// ── read-only notes
if (D.failed.length || D.orphan.length) {
  h = '<h2>Needs a closer look <span class="n">' + (D.failed.length + D.orphan.length) + '</span></h2><p class="hint">Not applied by this page. Ask Claude to fix these by hand if they matter.</p>';
  for (const f of D.failed) {
    h += '<div class="card"><h3>#' + f.id + ' ' + (f.url ? '<a target="_blank" rel="noopener" href="' + esc(f.url) + '">' + esc(f.name) + '</a>' : esc(f.name)) + '</h3><p class="meta">Failed a check (read by ' + esc(f.model || "?") + ')</p>';
    for (const i of f.issues) h += '<div class="flag">' + esc(i.text) + '</div>' + (i.line ? evidence({ line: i.line, quote: i.quote, url: i.url }) : '');
    h += '</div>';
  }
  for (const o of D.orphan) h += '<div class="card"><h3>#' + o.id + ' ' + (o.url ? '<a target="_blank" rel="noopener" href="' + esc(o.url) + '">' + esc(o.name) + '</a>' : esc(o.name)) + '</h3><div class="flag">' + esc(o.issue) + '</div></div>';
  $("#needs").innerHTML = h;
}

// ── state
const boxes = () => [...document.querySelectorAll("input[type=checkbox]")];
function picks() {
  const p = { groups: {}, quiet: [], ai: [] };
  for (const b of boxes()) if (b.checked) {
    if (b.dataset.op) (p.groups[b.dataset.op] = p.groups[b.dataset.op] || []).push(b.dataset.gid);
    else if (b.dataset.quiet) p.quiet.push(+b.dataset.quiet);
    else if (b.dataset.ai) p.ai.push(+b.dataset.ai);
  }
  return p;
}
function count() {
  const p = picks();
  const g = Object.values(p.groups).reduce((n, a) => n + a.length, 0);
  $("#sum").textContent = g + " change" + (g === 1 ? "" : "s") + " · " + p.ai.length + " AI label" + (p.ai.length === 1 ? "" : "s") + " · " + p.quiet.length + " checks recorded";
  $("#apply").disabled = true;
}
// New-edition deadlines and the new dates go together.
document.addEventListener("change", e => {
  const b = e.target, op = b.dataset.op;
  if (!op) return;
  const sel = s => [...document.querySelectorAll('input[data-op="' + op + '"]' + s)];
  if ("needsEdition" in b.dataset && b.checked) sel('[data-gid="edition"]').forEach(x => (x.checked = true));
  if (b.dataset.gid === "edition" && !b.checked) sel("[data-needs-edition]").forEach(x => (x.checked = false));
});
document.addEventListener("change", count);
const ac = $("#all-clean");
if (ac) ac.onclick = () => { for (const b of boxes()) if (b.dataset.op && !("flag" in b.dataset)) b.checked = true; count(); };
const nn = $("#none");
if (nn) nn.onclick = () => { for (const b of boxes()) if (b.dataset.op || b.dataset.ai) b.checked = false; count(); };
count();

function result(title, r) {
  $("#result").innerHTML = '<h2>' + esc(title) + '</h2><pre class="out' + (r.ok ? '' : ' bad') + '">' + esc(r.output || "(no output)") + '</pre>';
  $("#result").scrollIntoView({ behavior: "smooth" });
}
$("#save").onclick = async () => {
  $("#save").disabled = true;
  const r = await (await fetch("/save", { method: "POST", body: JSON.stringify(picks()) })).json();
  $("#save").disabled = false;
  result("Preview: " + r.count + " ops saved to scripts/conf-approved.json (nothing written to the site yet)", r);
  $("#apply").disabled = !r.ok || !r.count;
};
$("#apply").onclick = async () => {
  if (!confirm("Write these changes into index.html? (Nothing is published until you say commit push.)")) return;
  $("#apply").disabled = $("#save").disabled = true;
  const r = await (await fetch("/apply", { method: "POST" })).json();
  result(r.ok ? "Applied to index.html. Tell Claude “commit push” to publish." : "Apply failed. index.html was not changed.", r);
};
</script></body></html>`;

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`approval page: ${url}   (Ctrl+C to stop)`);
  console.log(`  ${current.cards.length} entries with changes · ${current.quiet.length} outcome-only · ${current.ai.length} AI suggestions · ${current.failed.length + current.orphan.length} need a look`);
  if (!argv.includes("--no-open")) execFile("open", [url]);
});
