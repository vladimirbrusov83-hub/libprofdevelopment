// Search-engine and LLM visibility, generated from the CONFERENCES array so it
// can never drift from the page. Runs automatically after every conf-apply
// write (conf-lib.write calls it); run by hand after editing index.html:
//
//   node scripts/conf-seo.js
//
// Writes:
//   event/<slug>/index.html   one page per conference series (editions share a slug),
//   event/<slug>/calendar.ics with full Event markup and the organizer's own quotes
//   deadlines/index.html      every upcoming dated deadline, by month
//   ai-conferences/index.html upcoming events with 100% AI focus or a major AI track
//   sitemap.xml, robots.txt, llms.txt
//   and three marked blocks inside index.html: the <title>, static JSON-LD in
//   <head>, and a plain-HTML list of upcoming conferences inside #cards-container
//   (the page's JavaScript replaces it on load; crawlers that don't run
//   JavaScript still read real content and follow its links).
//
// The generated folders are wiped and rebuilt every run, so a dropped
// conference's page disappears with it. Pages are snapshots: they use absolute
// dates only, and are only as fresh as the last run.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://libprofdevelopment.vercel.app";
const NAME = "Professional Development for Academic Libraries";
const DESC = "A directory of conferences, calls for proposals, and registration deadlines for academic library and higher-education professionals, with each event checked against the organizer's own site and rated for its AI content.";
const FORMAT = { virtual: "Virtual", inperson: "In person", hybrid: "Hybrid" };
const AI = { ai100: "100% AI focus", aibig: "Major AI track", aisig: "AI varies (general conference)" };
const AI_PILL = { ai100: "100% AI focus", aibig: "Major AI track", aisig: "AI varies" };
const MODE = { virtual: "https://schema.org/OnlineEventAttendanceMode", inperson: "https://schema.org/OfflineEventAttendanceMode", hybrid: "https://schema.org/MixedEventAttendanceMode" };
const GENERATED = ["event", "deadlines", "ai-conferences"];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const monthLabel = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtLong = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const pageUrl = c => `${SITE}/event/${c.slug}/`;
const audience = c => c.category === "edu" ? "Higher education" : "Academic libraries";
const hasExactDates = c => new RegExp("\\b" + Number(c.dateSort.slice(8)) + "\\b").test(c.dates.replace(/20\d\d/g, ""));
const clip = (s, n) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)) + "…";
const host = u => new URL(u).hostname.replace(/^www\./, "");
// Same text-fragment link the cards use: jumps to the quoted line on the organizer's page.
const textLink = x => {
  const part = x.quote.split(" · ").sort((a, b) => b.length - a.length)[0].split(" ").slice(0, 10).join(" ");
  return x.url + "#:~:text=" + encodeURIComponent(part).replace(/-/g, "%2D");
};

function replaceBlock(html, name, body) {
  const start = `<!--${name}:START-->`, end = `<!--${name}:END-->`;
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`index.html is missing the ${name} markers`);
  return html.slice(0, a + start.length) + "\n" + body + "\n" + html.slice(b);
}

function eventLd(c, url) {
  const place = { "@type": "Place", "name": c.location, "address": c.location };
  const virtual = { "@type": "VirtualLocation", "url": c.url };
  return {
    "@type": "Event", "@id": url + "#event", "name": c.name, "url": url,
    "startDate": c.dateSort, ...(c.dateEnd ? { "endDate": c.dateEnd } : {}),
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": MODE[c.format] || MODE.inperson,
    "description": c.description, "image": SITE + "/og-image.png",
    // No prices or speaker lists are kept, so the offer only points to the
    // organizer's page and "performer" is left out rather than guessed.
    "offers": { "@type": "Offer", "url": c.url },
    "organizer": { "@type": "Organization", "name": c.organizer, "url": new URL(c.url).origin },
    "location": c.format === "virtual" ? virtual : c.format === "hybrid" ? [place, virtual] : place,
    "sameAs": c.url
  };
}

const crumbsLd = items => ({
  "@type": "BreadcrumbList",
  "itemListElement": items.map(([name, url], i) => ({ "@type": "ListItem", "position": i + 1, "name": name, "item": url }))
});

// ── Shared look for the generated pages: the homepage's tokens, header and footer.
const CSS = `:root{--navy:#0b2545;--navy-2:#13315c;--blue:#1d5fa8;--blue-dark:#174c87;--sky:#e8f0fa;--gold:#c9a227;--bg:#f4f6f9;--line:#dde3ea;--line-2:#c9d2dd;--ink:#16202e;--text:#334155;--muted:#5a6778;--radius:4px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font-family:"Public Sans",system-ui,-apple-system,sans-serif;font-size:15.5px;line-height:1.6;min-height:100vh;display:flex;flex-direction:column}
a{color:var(--blue-dark)}
:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.container{max-width:880px;margin:0 auto;padding:0 24px;width:100%}
.util{background:var(--navy);color:#c9d4e3;font-size:12.5px}
.util .container{display:flex;justify-content:space-between;gap:12px;padding-top:7px;padding-bottom:7px}
.util a{color:#fff;font-weight:600;text-decoration:none}
.mast{background:var(--navy-2);color:#fff;border-bottom:4px solid var(--gold)}
.mast .container{display:flex;align-items:center;gap:14px;padding-top:16px;padding-bottom:16px}
.mast a{color:#fff;text-decoration:none;display:flex;align-items:center;gap:14px}
.shield{flex-shrink:0;width:40px;height:46px;background:#fff;color:var(--navy);clip-path:polygon(0 0,100% 0,100% 70%,50% 100%,0 70%);display:grid;place-items:center;font-family:Merriweather,Georgia,serif;font-size:14px;padding-bottom:7px}
.mast-title{font-family:Merriweather,Georgia,serif;font-size:19px;line-height:1.25}
main{padding:22px 0 44px}
.crumbs{font-size:13px;color:var(--muted);margin-bottom:14px}
.crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:4px}
.crumbs li+li::before{content:"›";margin-right:4px;color:var(--line-2)}
.crumbs a{color:var(--muted)}
h1{font-size:30px;line-height:1.2;color:var(--navy);font-weight:800;letter-spacing:-.01em}
.lede{font-size:17px;color:var(--text);margin-top:8px}
.notice{margin-top:16px;padding:12px 14px;border:1px solid var(--line-2);border-top:3px solid var(--gold);background:#fff;border-radius:var(--radius);font-size:14.5px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;padding:9px 15px;border-radius:3px;border:1px solid var(--line-2);background:#fff;color:var(--navy);text-decoration:none}
.btn:hover{border-color:var(--navy-2)}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff}
.btn.primary:hover{background:var(--blue-dark)}
.box{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;margin-top:18px}
h2{font-size:15px;font-weight:700;color:var(--navy-2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px}
.facts{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 16px}
.facts dt{color:var(--muted);font-size:14px}
.facts dd{font-weight:500}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--sky);color:var(--blue-dark);white-space:nowrap}
.pill.ai100{background:#e3f4ea;color:#1f6b41}.pill.aibig{background:#fbf3d9;color:#7a5d00}.pill.aisig{background:#eef1f5;color:var(--muted)}
.dls{list-style:none}
.dls li{display:grid;grid-template-columns:130px minmax(0,1fr);gap:12px;padding:8px 0;border-top:1px solid var(--line)}
.dls li:first-child{border-top:0;padding-top:0}
.dls time{font-weight:700;color:var(--navy)}
.dls .passed{color:var(--muted)}.dls .passed time{color:var(--muted);text-decoration:line-through}
.small{font-size:13px;color:var(--muted);margin-top:10px}
.quotes{list-style:none}
.quotes li{padding:10px 0;border-top:1px solid var(--line)}
.quotes li:first-child{border-top:0;padding-top:0}
.quotes b{display:block;font-size:13px;color:var(--navy)}
.quotes q{display:block;font-style:italic;color:var(--text);margin:3px 0}
.quotes small{color:var(--muted)}
.list{list-style:none}
.list li{padding:10px 0;border-top:1px solid var(--line)}
.list li:first-child{border-top:0;padding-top:0}
.list a{font-weight:700;text-decoration:none}
.list a:hover{text-decoration:underline}
.list .meta{display:block;font-size:13.5px;color:var(--muted)}
.mh{font-size:13px;font-weight:700;color:var(--navy-2);text-transform:uppercase;letter-spacing:.08em;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--navy-2)}
.intro{margin-top:10px;color:var(--text);max-width:42em}
.browse{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:14px;margin-top:22px}
footer{margin-top:auto;background:var(--navy);color:#b8c6da;font-size:13.5px}
footer .container{padding-top:26px;padding-bottom:26px}
footer a{color:#fff;text-decoration:underline;text-decoration-color:rgba(255,255,255,.35);text-underline-offset:3px}
footer p+p{margin-top:8px}
@media (max-width:640px){.container{padding:0 16px}.util .container{flex-direction:column;gap:2px}.mast-title{font-size:16px}h1{font-size:24px}.lede{font-size:16px}.facts{grid-template-columns:1fr;gap:2px}.facts dd{margin-bottom:8px}.dls li{grid-template-columns:1fr;gap:0}.box{padding:16px}}`;

function shell({ title, desc, url, jsonLd, body, lastChecked }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="author" content="Yulia Brusova">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="theme-color" content="#13315c">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&family=Merriweather:wght@700&display=swap" rel="stylesheet">
${ld(jsonLd)}
<style>${CSS}</style>
</head>
<body>
<div class="util"><div class="container"><span>Conference directory for academic library and higher-education professionals</span><a href="/">← All conferences</a></div></div>
<header class="mast"><div class="container"><a href="/"><span class="shield" aria-hidden="true">PD</span><span class="mast-title">${NAME}</span></a></div></header>
<main><div class="container">
${body}
<nav class="browse" aria-label="Browse the directory"><a href="/">All upcoming conferences</a><a href="/deadlines/">Upcoming deadlines</a><a href="/ai-conferences/">AI conferences</a></nav>
</div></main>
<footer><div class="container">
<p>${NAME}: a directory of conferences and professional development for academic library and higher-education workers. Dates and deadlines are checked against each organizer's own site; always confirm there before you register.</p>
<p>Last checked ${fmtLong(lastChecked)} · Compiled by Yulia Brusova · © 2026 Iuliia Brusova. <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" rel="noopener noreferrer">CC BY-NC-SA 4.0</a></p>
</div></footer>
</body>
</html>
`;
}

function ics(c) {
  const ymd = iso => iso.replace(/-/g, "");
  const end = new Date((c.dateEnd || c.dateSort) + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const icsEsc = t => String(t).replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Professional Development for Academic Libraries//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:conf-${c.id}-${c.dateSort}@libprofdevelopment`,
    `DTSTAMP:${ymd(c.checked || c.dateSort)}T000000Z`,
    `DTSTART;VALUE=DATE:${ymd(c.dateSort)}`,
    `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${icsEsc(c.name)}`,
    `LOCATION:${icsEsc(c.location)}`,
    `DESCRIPTION:${icsEsc(c.organizer + " · " + c.url)}`,
    `URL:${c.url}`,
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
}

function eventPage({ c, others, related, today, lastChecked }) {
  const url = pageUrl(c);
  const past = (c.dateEnd || c.dateSort) < today;
  const dls = (c.deadlines || []).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  const nextDl = dls.find(d => d.date >= today);
  const where = c.format === "virtual" ? "online" : c.location;
  const title = `${c.name}: Dates, Deadlines & Location`;
  const desc = clip(`${c.name}: ${c.dates}, ${where}.${nextDl ? ` ${nextDl.what}: ${fmt(nextDl.date)}.` : ""} Organized by ${c.organizer}. Dates checked against the organizer's own site.`, 158);
  const srcs = (c.sources || []).filter(x => x.about === "dates" || !past);
  const calendar = !past && hasExactDates(c);

  let body = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Conferences</a></li><li><a href="/#conf-${c.id}">${esc(monthLabel(c.dateSort))}</a></li><li aria-current="page">${esc(c.name)}</li></ol></nav>
<h1>${esc(c.name)}</h1>
<p class="lede">${esc(c.dates)} · ${esc(c.location)}${c.format !== "inperson" && !/virtual|online/i.test(c.location) ? " · " + FORMAT[c.format] : ""}</p>
${past ? `<p class="notice">This edition has ended. The next one isn't listed here yet; the organizer's site usually announces it first.</p>` : ""}
<div class="actions"><a class="btn primary" href="${esc(c.url)}" rel="noopener">Official site: ${esc(host(c.url))}</a>${calendar ? `<a class="btn" href="/event/${c.slug}/calendar.ics" download>Add to calendar</a>` : ""}</div>
<section class="box"><h2>At a glance</h2><dl class="facts">
<dt>Dates</dt><dd>${esc(c.dates)}</dd>
<dt>Location</dt><dd>${esc(c.location)}</dd>
<dt>Format</dt><dd>${FORMAT[c.format]}</dd>
<dt>Organizer</dt><dd>${esc(c.organizer)}</dd>
<dt>Audience</dt><dd>${audience(c)}</dd>
<dt>AI focus</dt><dd><span class="pill ${c.aiFocus}">${AI_PILL[c.aiFocus]}</span>${c.aiFocus === "aisig" ? " · general conference; AI programming varies by year" : ""}</dd>
${c.checked ? `<dt>Last checked</dt><dd>${fmtLong(c.checked)}, against ${esc(host(c.url))}</dd>` : ""}
</dl></section>
`;
  if (dls.length || (c.deadline && !/^(tba|see site|check website|null)$/i.test(c.deadline))) {
    body += `<section class="box"><h2>Deadlines</h2>`;
    if (dls.length) body += `<ul class="dls">${dls.map(d => `<li${d.date < today ? ' class="passed"' : ""}><time datetime="${d.date}">${fmt(d.date)}</time><span>${esc(d.what)}${d.date < today ? " (passed)" : ""}</span></li>`).join("")}</ul>`;
    if (c.deadline && !/^(tba|see site|check website|null)$/i.test(c.deadline)) body += `<p class="small">${esc(c.deadline)}</p>`;
    body += `<p class="small">Deadlines can move. Confirm on the organizer's site before you plan around one.</p></section>\n`;
  }
  body += `<section class="box"><h2>About this conference</h2><p>${esc(c.description)}</p></section>\n`;
  if (srcs.length) {
    body += `<section class="box"><h2>Sources</h2><p class="small" style="margin:0 0 10px">The organizer's own words behind the dates above.</p><ul class="quotes">${srcs.map(x => {
      const d = x.about === "dates" ? null : dls.find(d => d.date === x.date);
      const label = x.about === "dates" ? "Dates" : `${esc(d ? d.what : "Deadline")} · ${fmt(x.date)}`;
      return `<li><b>${label}</b><q>${esc(x.quote)}</q><small>Quoted from <a href="${esc(textLink(x))}" rel="noopener">${esc(host(x.url))}</a> on ${fmt(x.seen)}</small></li>`;
    }).join("")}</ul></section>\n`;
  }
  if (others.length) {
    body += `<section class="box"><h2>Other editions</h2><ul class="list">${others.map(o => `<li><a href="${esc(o.url)}" rel="noopener">${esc(o.name)}</a><span class="meta">${esc(o.dates)} · ${esc(o.location)}</span></li>`).join("")}</ul></section>\n`;
  }
  if (related.length) {
    body += `<section class="box"><h2>Around the same time</h2><ul class="list">${related.map(r => `<li><a href="/event/${r.slug}/">${esc(r.name)}</a><span class="meta">${esc(r.dates)} · ${esc(r.location)} · ${AI_PILL[r.aiFocus]}</span></li>`).join("")}</ul></section>\n`;
  }

  const jsonLd = { "@context": "https://schema.org", "@graph": [
    eventLd(c, url),
    crumbsLd([["Conferences", SITE + "/"], [c.name, url]])
  ] };
  return shell({ title, desc, url, jsonLd, body, lastChecked });
}

function listPage({ path: p, title, h1, intro, desc, groups, lastChecked, emptyText }) {
  const url = `${SITE}/${p}/`;
  const items = groups.flatMap(g => g.items);
  let body = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Conferences</a></li><li aria-current="page">${esc(h1)}</li></ol></nav>
<h1>${esc(h1)}</h1>
<p class="intro">${intro}</p>
`;
  if (!items.length) body += `<p class="notice">${emptyText}</p>`;
  for (const g of groups) {
    body += `<h2 class="mh">${esc(g.label)}</h2><section class="box" style="margin-top:0"><ul class="list">${g.items.map(i => `<li><a href="/event/${i.c.slug}/">${esc(i.title || i.c.name)}</a><span class="meta">${i.meta}</span></li>`).join("")}</ul></section>\n`;
  }
  const jsonLd = { "@context": "https://schema.org", "@graph": [
    { "@type": "CollectionPage", "@id": url, "url": url, "name": title, "description": desc, "isPartOf": { "@id": SITE + "/#site" } },
    { "@type": "ItemList", "numberOfItems": items.length, "itemListElement": items.map((i, n) => ({ "@type": "ListItem", "position": n + 1, "url": pageUrl(i.c), "name": i.title || i.c.name })) },
    crumbsLd([["Conferences", SITE + "/"], [h1, url]])
  ] };
  return shell({ title, desc, url, jsonLd, body, lastChecked });
}

function byMonth(items, dateOf) {
  const groups = [];
  for (const i of items) {
    const label = monthLabel(dateOf(i));
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(i);
  }
  return groups;
}

function generate({ quiet = false } = {}) {
  const { parse, readHtml, HTML } = require("./conf-lib");
  const today = new Date().toISOString().slice(0, 10);
  const all = parse().filter(c => !String(c.dateSort).startsWith("2025"));
  const isUp = c => (c.dateEnd || c.dateSort) >= today;
  const bySort = (a, b) => a.dateSort < b.dateSort ? -1 : a.dateSort > b.dateSort ? 1 : 0;
  const upcoming = all.filter(isUp).sort(bySort);
  // "Last checked" = the newest date a refresh confirmed an entry, not the day this ran.
  const lastChecked = all.map(c => c.checked).filter(Boolean).sort().pop() || today;
  const next = c => (c.deadlines || []).filter(d => d.date >= today).sort((a, b) => a.date < b.date ? -1 : 1)[0];
  const missing = all.filter(c => !c.slug);
  if (missing.length) throw new Error(`No slug on ${missing.map(c => "#" + c.id).join(", ")}: run node scripts/conf-seo.js by hand once to assign them`);

  // One page per slug. The page leads with the nearest upcoming edition, or the
  // latest one when every edition has passed; the rest are listed under it.
  const series = new Map();
  for (const c of all) { if (!series.has(c.slug)) series.set(c.slug, []); series.get(c.slug).push(c); }
  const primary = new Map();
  for (const [slug, eds] of series) {
    const up = eds.filter(isUp).sort(bySort);
    primary.set(slug, up[0] || eds.slice().sort(bySort).pop());
  }

  // ── Generated folders, rebuilt from scratch
  for (const dir of GENERATED) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  const writeFile = (rel, text) => {
    const f = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  for (const [slug, c] of primary) {
    const others = series.get(slug).filter(x => x !== c).sort(bySort);
    // Up to five other upcoming conferences nearest in date (same series excluded).
    const pool = upcoming.filter(x => x.slug !== slug && primary.get(x.slug) === x);
    const days = x => Math.abs(Date.parse(x.dateSort) - Date.parse(c.dateSort));
    const related = pool.slice().sort((a, b) => days(a) - days(b)).slice(0, 5).sort(bySort);
    writeFile(`event/${slug}/index.html`, eventPage({ c, others, related, today, lastChecked }));
    if (isUp(c) && hasExactDates(c)) writeFile(`event/${slug}/calendar.ics`, ics(c));
  }

  // ── Deadlines and AI hub pages
  const dlItems = upcoming.filter(c => primary.get(c.slug) === c)
    .flatMap(c => (c.deadlines || []).filter(d => d.date >= today).map(d => ({ c, d })))
    .sort((a, b) => a.d.date < b.d.date ? -1 : a.d.date > b.d.date ? 1 : 0)
    .map(({ c, d }) => ({ c, d, title: `${c.name}: ${d.what}`, meta: `<b>${fmt(d.date)}</b> · conference ${esc(c.dates)} · ${esc(c.location)}` }));
  writeFile("deadlines/index.html", listPage({
    path: "deadlines",
    title: "Library Conference Deadlines: Calls for Proposals & Registration",
    h1: "Upcoming conference deadlines",
    intro: `Calls for proposals, early-bird registration and other dated deadlines for ${upcoming.length} upcoming academic library and higher-education conferences, soonest first. Each date was checked against the organizer's own site.`,
    desc: "Upcoming calls for proposals, early-bird and registration deadlines for academic library and higher-education conferences, soonest first, each checked against the organizer's site.",
    groups: byMonth(dlItems, i => i.d.date), lastChecked,
    emptyText: "No dated deadlines are listed right now."
  }));
  const aiItems = upcoming.filter(c => primary.get(c.slug) === c && (c.aiFocus === "ai100" || c.aiFocus === "aibig"))
    .map(c => ({ c, meta: `${esc(c.dates)} · ${esc(c.location)} · ${AI_PILL[c.aiFocus]}${next(c) ? ` · ${esc(next(c).what)} ${fmt(next(c).date)}` : ""}` }));
  writeFile("ai-conferences/index.html", listPage({
    path: "ai-conferences",
    title: "AI Conferences for Librarians & Higher Education",
    h1: "AI conferences for librarians and higher education",
    intro: `${aiItems.length} upcoming conferences that are entirely about AI or run a major AI track, for academic library and higher-education professionals. General conferences where AI programming varies are in the <a href="/">full directory</a>.`,
    desc: "Upcoming conferences on artificial intelligence for academic librarians and higher-education professionals: events entirely about AI or with a major AI track, with dates and deadlines.",
    groups: byMonth(aiItems, i => i.c.dateSort), lastChecked,
    emptyText: "No upcoming AI conferences are listed right now."
  }));

  // ── Homepage: title years, JSON-LD (site + list pointing at each page), static list
  const years = [...new Set(upcoming.map(c => c.dateSort.slice(0, 4)))].sort();
  const span = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || today.slice(0, 4);
  const homeTitle = `<title>Academic Library Conferences ${span}: Dates & Deadlines | ${NAME}</title>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": SITE + "/#site", "url": SITE + "/", "name": NAME, "description": DESC, "inLanguage": "en",
        "author": { "@type": "Person", "name": "Yulia Brusova" } },
      { "@type": "ItemList", "name": "Upcoming conferences for academic library professionals", "numberOfItems": upcoming.length,
        "itemListElement": upcoming.map((c, i) => ({ "@type": "ListItem", "position": i + 1, "url": pageUrl(c), "name": c.name })) }
    ]
  };

  let list = `<div class="static-list">\n<p class="static-note">${upcoming.length} upcoming conferences, by month. Last checked ${fmt(lastChecked)}. Also: <a href="/deadlines/">upcoming deadlines</a> · <a href="/ai-conferences/">AI conferences</a>.</p>\n`;
  let month = null;
  for (const c of upcoming) {
    const m = c.dateSort.slice(0, 7);
    if (m !== month) { list += `<h2 class="mh">${monthLabel(c.dateSort)}</h2>\n`; month = m; }
    const d = next(c);
    list += `<article class="card static"><div><h3><a href="/event/${c.slug}/">${esc(c.name)}</a></h3>`
      + `<p class="meta"><span class="when">${esc(c.dates)}</span> · ${esc(c.location)} · ${FORMAT[c.format]} · ${esc(c.organizer)}</p>`
      + `<p class="desc">${esc(c.description)}</p>`
      + `<p class="meta">${audience(c)} · ${AI[c.aiFocus]}${d ? ` · ${esc(d.what)} ${fmt(d.date)}` : ""}</p></div></article>\n`;
  }
  list += `</div>`;

  let html = readHtml();
  html = html.replace(/<title>[^<]*<\/title>/, homeTitle);
  html = replaceBlock(html, "SEO-JSONLD", ld(jsonLd));
  html = replaceBlock(html, "SEO-LIST", list);
  fs.writeFileSync(HTML, html);

  // ── sitemap.xml + robots.txt (llms.txt isn't a search result, so it stays out)
  const maxChecked = slug => series.get(slug).map(c => c.checked).filter(Boolean).sort().pop();
  const urls = [
    [SITE + "/", lastChecked], [SITE + "/deadlines/", lastChecked], [SITE + "/ai-conferences/", lastChecked],
    ...[...primary.keys()].sort().map(slug => [`${SITE}/event/${slug}/`, maxChecked(slug)])
  ];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, mod]) => `  <url><loc>${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`);
  fs.writeFileSync(path.join(ROOT, "robots.txt"),
`# Everyone, including AI crawlers, is welcome to read and cite this directory.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);

  // ── llms.txt (https://llmstxt.org): a clean Markdown copy for language models
  let md = `# ${NAME}\n\n> ${DESC}\n\nCompiled by Yulia Brusova. Site: ${SITE}/ · Last checked: ${fmt(lastChecked)} · ${upcoming.length} upcoming of ${all.length} tracked events.\n\n`;
  md += `How the data is kept: each listing links to the organizer's own page. A refresh script downloads those pages, a language model extracts dates and deadlines with exact quotes, and a separate check confirms every date appears on the organizer's page before it is published. "AI focus" means: 100% AI focus = the whole event is about AI; Major AI track = the program names an AI theme or track; AI varies = a general conference included for completeness.\n\n`;
  md += `Each conference has its own page with dates, deadlines and the organizer's quoted source lines (linked below). Lists: upcoming deadlines ${SITE}/deadlines/ · AI conferences ${SITE}/ai-conferences/\n\n`;
  md += `## Upcoming conferences\n\n`;
  month = null;
  for (const c of upcoming) {
    const m = c.dateSort.slice(0, 7);
    if (m !== month) { md += `\n### ${monthLabel(c.dateSort)}\n\n`; month = m; }
    const d = next(c);
    md += `- [${c.name}](${pageUrl(c)}): ${c.dates}; ${c.location}; ${FORMAT[c.format]}; ${c.organizer}; ${AI[c.aiFocus]}${d ? `; next deadline: ${d.what}, ${fmt(d.date)}` : ""}. ${c.description} Official site: ${c.url}\n`;
  }
  md += `\n## Related\n\n- AI for Academic Libraries, a free practitioner curriculum by the same author, mapped to the ACRL AI Competencies: https://ai-for-academic-libraries.vercel.app\n`;
  fs.writeFileSync(path.join(ROOT, "llms.txt"), md);

  if (!quiet) console.log(`SEO: ${primary.size} conference pages, ${dlItems.length} deadlines, ${aiItems.length} AI conferences; ${upcoming.length} upcoming → index.html, sitemap.xml (${urls.length} URLs), robots.txt, llms.txt`);
  return upcoming.length;
}

module.exports = { generate };
if (require.main === module) {
  // By hand after editing index.html: entries added without a slug get one first.
  const lib = require("./conf-lib");
  const list = lib.parse();
  if (list.some(c => !c.slug)) lib.write(list); // write() assigns slugs, then calls generate
  generate();
}
