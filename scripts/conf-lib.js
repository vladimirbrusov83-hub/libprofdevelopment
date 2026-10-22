// Shared helpers for the conference directory in index.html.
// The page is a static, single-file HTML app: one `const CONFERENCES = [...]`
// array drives everything. These helpers parse it out and write it back with
// stable formatting so diffs stay readable.

const fs = require("fs");
const path = require("path");

// CONF_HTML points the scripts at another copy, for --dry and read-only use only:
// a real apply would still write this repo's conf-state.json, sitemap and llms.txt.
const HTML = process.env.CONF_HTML || path.join(__dirname, "..", "index.html");

// Canonical key order — matches how the array is already written by hand.
const KEYS = [
  "id", "name", "organizer", "dates", "dateSort", "dateEnd", "location",
  "format", "url", "urlVerified", "urlNote", "category", "aiFocus",
  "international", "description", "deadline", "deadlines", "checked"
];

const AI_FOCUS = ["ai100", "aibig", "aisig"];
const FORMATS = ["inperson", "virtual", "hybrid"];
const CATEGORIES = ["lib", "edu"];

const RE = /(const CONFERENCES = )(\[[\s\S]*?\n\]);/;

function readHtml() {
  return fs.readFileSync(HTML, "utf8");
}

function parse(html = readHtml()) {
  const m = html.match(RE);
  if (!m) throw new Error("Could not locate the CONFERENCES array in " + HTML);
  return eval(m[2]);
}

function serialize(list) {
  const entries = list.map(c => {
    const lines = KEYS
      .filter(k => c[k] !== undefined && c[k] !== null || k === "deadline")
      .map(k => {
        const v = k === "deadline" && c[k] == null ? null : c[k];
        return `    ${k}: ${JSON.stringify(v)}`;
      });
    return "  {\n" + lines.join(",\n") + "\n  }";
  });
  return "[\n" + entries.join(",\n") + "\n]";
}

// Past/upcoming is computed by the page at load time, never stored.
function isPast(c, today = new Date().toISOString().slice(0, 10)) {
  return (c.dateEnd || c.dateSort) < today;
}

// Entries dated 2025 are filtered out by the page and render nowhere.
function isHidden(c) {
  return String(c.dateSort).startsWith("2025");
}

// Hard errors block a write. The 2025 problem is reported separately by
// conf-audit as a warning: those rows are already in the file and blocking
// every write until they are all resolved would be worse than surfacing them.
function validate(list) {
  const errs = [];
  const seen = new Set();
  for (const c of list) {
    const at = `#${c.id} ${c.name}`;
    if (!Number.isInteger(c.id)) errs.push(`${at}: id must be an integer`);
    if (seen.has(c.id)) errs.push(`${at}: duplicate id`);
    seen.add(c.id);
    for (const k of ["name", "organizer", "dates", "location", "url", "description"]) {
      if (!c[k]) errs.push(`${at}: missing ${k}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dateSort || "")) errs.push(`${at}: bad dateSort ${c.dateSort}`);
    if (c.dateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(c.dateEnd)) errs.push(`${at}: bad dateEnd ${c.dateEnd}`);
    if (c.dateEnd && c.dateEnd < c.dateSort) errs.push(`${at}: dateEnd before dateSort`);
    if (!AI_FOCUS.includes(c.aiFocus)) errs.push(`${at}: bad aiFocus ${c.aiFocus}`);
    if (!FORMATS.includes(c.format)) errs.push(`${at}: bad format ${c.format}`);
    if (!CATEGORIES.includes(c.category)) errs.push(`${at}: bad category ${c.category}`);
    if (typeof c.urlVerified !== "boolean") errs.push(`${at}: urlVerified must be boolean`);
    if (typeof c.international !== "boolean") errs.push(`${at}: international must be boolean`);
    if (!/^https:\/\//.test(c.url || "")) errs.push(`${at}: url must be https`);
    // `deadlines` = dated, actionable deadlines ({ date: "YYYY-MM-DD", what: "Proposals due" })
    // that drive the "Closing soon" strip; `deadline` stays as the free-text status note.
    if (c.deadlines !== undefined) {
      if (!Array.isArray(c.deadlines)) errs.push(`${at}: deadlines must be an array`);
      else for (const d of c.deadlines) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d && d.date || "") || !(d && d.what)) errs.push(`${at}: each deadline needs date (YYYY-MM-DD) and what`);
      }
    }
    // `checked` = the day a refresh last loaded the organizer's site and confirmed the entry.
    if (c.checked !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.checked)) errs.push(`${at}: bad checked ${c.checked}`);
    // Rolling an event forward means renaming it too — a card reading
    // "IFLA WLIC 2026" above 2027 dates is the easy mistake here.
    const yrs = (c.name || "").match(/20\d\d/g);
    if (yrs && !yrs.includes(String(c.dateSort).slice(0, 4))) {
      errs.push(`${at}: name says ${yrs.join("/")} but dateSort is ${c.dateSort} — update the name too`);
    }
  }
  return errs;
}

function write(list, { footerDate } = {}) {
  const errs = validate(list);
  if (errs.length) {
    throw new Error("Refusing to write — validation failed:\n  " + errs.join("\n  "));
  }
  let html = readHtml();
  fs.writeFileSync(HTML + ".bak", html);
  html = html.replace(RE, (_, head, __) => head + serialize(list) + ";");
  if (footerDate) {
    html = html.replace(/Last updated [A-Za-z]+ \d+, \d{4}/g, "Last updated " + footerDate);
  }
  fs.writeFileSync(HTML, html);
  // Re-parse what we actually wrote — a stray quote renders the page blank
  // with no error, so never trust the in-memory copy.
  const back = parse(fs.readFileSync(HTML, "utf8"));
  if (back.length !== list.length) throw new Error("Round-trip mismatch after write");
  // Keep sitemap, robots, llms.txt and the crawler-readable copy in step with the data.
  require("./conf-seo").generate({ quiet: true });
  return back.length;
}

// Collapse a name to the conference *series* it belongs to: drop the year, the
// edition ordinal (71st, 49th, 71e, 12°), and any parenthetical suffix. Used to
// spot a stale row whose next edition is already tracked.
function seriesKey(name) {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/20\d\d/g, " ")
    .replace(/\b\d+\s*(st|nd|rd|th|e|°|er)\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// For each stale entry, the earliest later-dated edition of the same series
// already present in the list, or undefined.
function supersessions(list, today = new Date().toISOString().slice(0, 10)) {
  const groups = new Map();
  for (const c of list) {
    const k = seriesKey(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const map = new Map();
  for (const c of list) {
    if (!isPast(c, today)) continue;
    const later = groups.get(seriesKey(c.name))
      .filter(x => x.id !== c.id && x.dateSort > c.dateSort)
      .sort((a, b) => a.dateSort.localeCompare(b.dateSort))[0];
    if (later) map.set(c.id, later);
  }
  return map;
}

module.exports = { HTML, KEYS, parse, serialize, validate, write, isPast, isHidden, readHtml, seriesKey, supersessions };
