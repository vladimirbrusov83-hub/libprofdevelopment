// Stage 4 of the refresh workflow — the only thing that writes the HTML.
//
//   node scripts/conf-apply.js scripts/conf-updates.json [--footer "September 2, 2026"] [--dry]
//
// The updates file is a JSON array of ops:
//
//   { "id": 6,  "set": { "dates": "...", "dateSort": "..." }, "outcome": "resolved" }
//   { "id": 3,  "outcome": "no-future-edition", "note": "site says stay tuned" }
//   { "id": 9,  "drop": true, "note": "superseded by #8" }
//   { "add": { "name": "...", ... } }
//
// Every op may carry `outcome` and `note`; those go to scripts/conf-state.json,
// the sidecar that lets the next run skip what was just checked. Provenance
// lives there rather than in the HTML so the page's data model stays untouched.
//
// Nothing is written until the whole result validates, the previous file is
// saved to .bak, and the written file is re-parsed — a stray quote renders the
// page blank with no error, so the in-memory copy is never trusted.

const fs = require("fs");
const path = require("path");
const { parse, validate, write, isHidden } = require("./conf-lib");

const STATE = path.join(__dirname, "conf-state.json");
const TODAY = new Date().toISOString().slice(0, 10);
// "Nothing announced" holds far longer than a live listing does.
// "Nothing announced" holds far longer than a live listing does. "blocked" is
// not an answer at all — the site refused us — so it retries soon.
const TTL_DAYS = { "no-future-edition": 90, resolved: 30, "not-found": 60, blocked: 14, dropped: 3650 };

const argv = process.argv.slice(2);
const file = argv[0];
if (!file || file.startsWith("--")) {
  console.error('usage: node scripts/conf-apply.js <updates.json> [--footer "Month D, YYYY"] [--dry]');
  process.exit(1);
}
const fi = argv.indexOf("--footer");
const footerDate = fi > -1 ? argv[fi + 1] : null;
const dry = argv.includes("--dry");

const plusDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const ops = JSON.parse(fs.readFileSync(file, "utf8"));
const list = parse();
const before = list.length;
const byId = new Map(list.map(c => [c.id, c]));
let nextId = Math.max(...list.map(c => c.id)) + 1;

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { entries: {} };
const dropped = new Set();
const log = [];

// Outcomes that mean someone actually read the organizer's page; these stamp the
// entry's visible "Checked <date>" mark. blocked / not-found never do.
const CONFIRMED = ["resolved", "no-future-edition"];

function record(id, outcome, note) {
  if (!outcome) return;
  const entry = byId.get(id) || list.find(c => c.id === id);
  if (entry && CONFIRMED.includes(outcome)) entry.checked = TODAY;
  state.entries[String(id)] = {
    lastChecked: TODAY,
    outcome,
    recheckAfter: plusDays(TTL_DAYS[outcome] ?? 30),
    ...(note ? { note } : {})
  };
}

for (const op of ops) {
  if (op.add) {
    const entry = { id: nextId++, urlVerified: false, international: false, deadline: null, ...op.add };
    list.push(entry);
    record(entry.id, op.outcome || "resolved", op.note);
    log.push(`add    #${entry.id} ${entry.name}`);
    continue;
  }
  const target = byId.get(op.id);
  if (!target) { console.error(`no entry with id ${op.id}`); process.exit(1); }

  if (op.drop) {
    dropped.add(op.id);
    record(op.id, "dropped", op.note);
    log.push(`drop   #${op.id} ${target.name}${op.note ? " — " + op.note : ""}`);
    continue;
  }
  if (op.set) {
    const changed = Object.keys(op.set).filter(k => JSON.stringify(target[k]) !== JSON.stringify(op.set[k]));
    Object.assign(target, op.set);
    // No outcome = a hand edit, not a site check: change the entry, leave its
    // "Checked" stamp and recheck schedule alone.
    record(op.id, op.outcome, op.note);
    log.push(`update #${op.id} ${target.name}${changed.length ? " [" + changed.join(", ") + "]" : " (no change)"}`);
    continue;
  }
  // Outcome-only op: nothing to change on the page, but the check still counts
  // so the next run can skip this entry until its TTL expires.
  if (op.outcome) {
    record(op.id, op.outcome, op.note);
    log.push(`note   #${op.id} ${target.name} — ${op.outcome}${op.note ? ": " + op.note : ""}`);
    continue;
  }
  console.error(`op for id ${op.id} has none of set, add, drop, outcome`);
  process.exit(1);
}

// Source order is preserved deliberately. The page sorts by dateSort at render
// time, so array order is cosmetic — and re-sorting here would rewrite all ~150
// entries on every run, turning each diff into something nobody can review.
const final = list.filter(c => !dropped.has(c.id));

const errs = validate(final);
if (errs.length) { console.error("validation failed — nothing written:\n  " + errs.join("\n  ")); process.exit(1); }

log.forEach(l => console.log(l));

if (dry) {
  console.log(`\ndry run — would write ${final.length} entries (was ${before}); no files touched`);
  process.exit(0);
}

const count = write(final, { footerDate });
fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

console.log(`\nwrote ${count} entries (was ${before}) · backup at index.html.bak`);
console.log(`state recorded for ${Object.keys(state.entries).length} entries → scripts/conf-state.json`);
if (footerDate) console.log(`footer set to "Last updated ${footerDate}"`);
const stillHidden = final.filter(isHidden);
if (stillHidden.length) console.log(`WARNING ${stillHidden.length} entries still dated 2025 and invisible: ${stillHidden.map(c => "#" + c.id).join(", ")}`);
