// Shared helpers for the evidence pipeline: page text, quote matching, dates.
// conf-fetch saves raw page text, conf-extract asks a model to read it, and
// conf-verify checks every claim against that same saved text — so a date only
// reaches the page if its quote really is on the organizer's site.

const fs = require("fs");
const path = require("path");

const PAGES = path.join(__dirname, "pages");
const MANIFEST = path.join(PAGES, "manifest.json");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table|ul|ol|dt|dd)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean)
    .join("\n");
}

// Same-site links whose wording suggests dates, fees or calls for proposals.
const LINK_WORDS = /regist|rates?\b|fees?\b|pricing|call[- ]for|cfp|proposal|submi|abstract|important[- ]dates|key[- ]dates|deadline|program/i;
function candidateLinks(html, baseUrl, max = 3) {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./, "");
  const seen = new Set([base.href.replace(/#.*$/, "")]);
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (!u.hostname.replace(/^www\./, "").endsWith(host)) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|pptx?)$/i.test(u.pathname)) continue;
    const href = u.href.replace(/#.*$/, "");
    if (seen.has(href)) continue;
    const text = htmlToText(m[2]).slice(0, 80);
    const score = (LINK_WORDS.test(text) ? 2 : 0) + (LINK_WORDS.test(u.pathname) ? 1 : 0);
    if (!score) continue;
    seen.add(href);
    out.push({ url: href, text, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

// Loose normalization so a faithfully copied quote still matches: case,
// whitespace, dashes, curly quotes, and "Sept." vs "Sep".
function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/\s*-\s*/g, "-")
    .replace(/[\s |]+/g, " ")
    .trim();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Does the quote state this ISO date? Accepts "Oct 23", "23 October",
// "October 23, 2026", "March 16 to 18", "Sept 24-October 23", "2026-10-23",
// "10/23/2026", "1/16-3/14/27", "22.-25.6.2027". A year in the quote must match;
// a quote with no year is allowed (rate tables often omit it).
function quoteHasDate(quote, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const q = norm(quote).replace(/(\d)\s?(st|nd|rd|th)\b/g, "$1");
  const years = (q.match(/\b20\d\d\b/g) || []).map(Number);
  if (years.length && !years.includes(y)) return false;
  if (q.includes(iso)) return true;
  const yy = n => n == null || n === "" || Number(n) === y || Number(n) === y % 100;
  // numeric US M/D(/YY)
  for (const t of q.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    if (+t[1] === m && +t[2] === d && yy(t[3])) return true;
  }
  // numeric European D.(-D.)M.YYYY
  for (const t of q.matchAll(/\b(\d{1,2})\.?(?:-(\d{1,2})\.?)?\.?(\d{1,2})\.(\d{2,4})\b/g)) {
    if (+t[3] === m && yy(t[4]) && (+t[1] === d || +t[2] === d)) return true;
  }
  const mon = MONTHS[m - 1];
  const RANGE = "(\\d{1,2}\\s*(-|to|through|thru|until|and|&)\\s*)?";
  const after = new RegExp(`\\b${mon}[a-z]*\\.?\\s*${RANGE}0?${d}\\b(?!\\s*:\\d)`);
  const before = new RegExp(`\\b0?${d}\\s*(-\\s*\\d{1,2}\\s*)?(of\\s+)?${mon}[a-z]*\\b`);
  return after.test(q) || before.test(q);
}

// The full line(s) of page text containing the quote. Type and label checks use
// this — the quote's own row, never neighbouring rows, so "Regular (Sept 24-Oct 23)"
// can't borrow "Early Bird" from the row above (the Charleston mistake).
function context(pageText, quote) {
  const q = norm(quote);
  const lines = pageText.split("\n");
  for (let span = 1; span <= 4; span++) {
    for (let i = 0; i + span <= lines.length; i++) {
      const chunk = norm(lines.slice(i, i + span).join(" "));
      if (chunk.includes(q)) return chunk;
    }
  }
  return q;
}

// Deadline types: fixed list, card label, and words the quote must contain so a
// real date can't be filed under the wrong kind of deadline (the Charleston bug).
const DEADLINE_TYPES = {
  proposals_due:       { what: "Proposals due",            words: /proposal|submission|submit|call for|cfp|abstract|presentation|session/ },
  papers_due:          { what: "Papers due",               words: /paper|submission|submit|manuscript/ },
  posters_due:         { what: "Posters due",              words: /poster|demo|lightning/ },
  early_bird_ends:     { what: "Early-bird rate ends",     words: /early/ },
  discount_ends:       { what: "Discounted rate ends",     words: /save|saving|discount|special pric|reduced|lower rate|member rate/ },
  regular_rate_ends:   { what: "Regular rate ends",        words: /regular|standard|advance|general/ },
  registration_closes: { what: "Registration closes",      words: /regist|sign up|rsvp/ },
  scholarship_due:     { what: "Scholarship applications due", words: /scholar|grant|award|fellow|stipend|travel/ }
};

function readManifest() {
  return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
}

function pageDir(id) { return path.join(PAGES, String(id)); }

// Saved pages for one entry: [{ n, url, text }]
function loadPages(id) {
  const m = readManifest()[id];
  if (!m) return [];
  return m.pages.filter(p => p.file).map((p, n) => ({
    n, url: p.url, text: fs.readFileSync(path.join(pageDir(id), p.file), "utf8")
  }));
}

// Public source links: decode &amp; left from raw href attributes and drop
// tracking parameters (HubSpot, Google, utm) so the card links stay clean.
function cleanUrl(u) {
  try {
    const x = new URL(String(u).replace(/&amp;/g, "&"));
    for (const k of [...x.searchParams.keys()]) if (/^(__hs|_gl$|_ga|utm_|gclid$|fbclid$|mc_)/.test(k)) x.searchParams.delete(k);
    return x.href.replace(/\?$/, "");
  } catch { return null; }
}

// A quote as a card shows it: one line, table pipes as middots.
function cleanQuote(q) {
  return String(q).replace(/\s*\|\s*/g, " · ").replace(/\s+/g, " ").replace(/^[\s·]+|[\s·]+$/g, "").trim();
}

// Verified claims → the entry's `sources`, kept only where the quote still states
// what the card shows (current start date, or a listed deadline's date).
function sourcesFor(entry, claims, seen) {
  const out = [];
  for (const cl of claims || []) {
    const url = cleanUrl(cl.url), quote = cleanQuote(cl.quote);
    if (!url || !url.startsWith("https://") || quote.length > 300) continue;
    let s = null;
    if (cl.field === "dates" && quoteHasDate(quote, entry.dateSort)) s = { about: "dates", date: entry.dateSort };
    else if (cl.date && (entry.deadlines || []).some(d => d.date === cl.date) && quoteHasDate(quote, cl.date)) s = { about: "deadline", date: cl.date };
    if (s && !out.some(o => o.about === s.about && o.date === s.date)) out.push({ ...s, quote, url, seen });
  }
  return out;
}

// Drop sources that no longer back anything on the card (dates rolled, deadline gone).
function pruneSources(entry) {
  if (!entry.sources) return;
  entry.sources = entry.sources.filter(s => s.about === "dates" ? s.date === entry.dateSort : (entry.deadlines || []).some(d => d.date === s.date));
  if (!entry.sources.length) delete entry.sources;
}

module.exports = { cleanUrl, cleanQuote, sourcesFor, pruneSources, PAGES, MANIFEST, htmlToText, candidateLinks, norm, quoteHasDate, context, DEADLINE_TYPES, readManifest, pageDir, loadPages };
