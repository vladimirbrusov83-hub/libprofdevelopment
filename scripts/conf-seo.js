// Search-engine and LLM visibility, generated from the CONFERENCES array so it
// can never drift from the page. Runs automatically after every conf-apply
// write (conf-lib.write calls it); run by hand after editing index.html:
//
//   node scripts/conf-seo.js
//
// Writes: sitemap.xml, robots.txt, llms.txt, and two marked blocks inside
// index.html — static JSON-LD in <head>, and a plain-HTML list of upcoming
// conferences inside #cards-container. The page's JavaScript replaces that
// list on load, but crawlers that don't run JavaScript (most AI crawlers)
// still read real content.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://libprofdevelopment.vercel.app";
const NAME = "Professional Development for Academic Libraries";
const DESC = "A directory of conferences, calls for proposals, and registration deadlines for academic library and higher-education professionals, with each event checked against the organizer's own site and rated for its AI content.";
const FORMAT = { virtual: "Virtual", inperson: "In person", hybrid: "Hybrid" };
const AI = { ai100: "100% AI focus", aibig: "Major AI track", aisig: "AI varies (general conference)" };
const MODE = { virtual: "https://schema.org/OnlineEventAttendanceMode", inperson: "https://schema.org/OfflineEventAttendanceMode", hybrid: "https://schema.org/MixedEventAttendanceMode" };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const monthLabel = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function replaceBlock(html, name, body) {
  const start = `<!--${name}:START-->`, end = `<!--${name}:END-->`;
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`index.html is missing the ${name} markers`);
  return html.slice(0, a + start.length) + "\n" + body + "\n" + html.slice(b);
}

function generate({ quiet = false } = {}) {
  const { parse, readHtml, HTML } = require("./conf-lib");
  const today = new Date().toISOString().slice(0, 10);
  const all = parse().filter(c => !String(c.dateSort).startsWith("2025"));
  const upcoming = all.filter(c => (c.dateEnd || c.dateSort) >= today).sort((a, b) => a.dateSort < b.dateSort ? -1 : 1);
  // "Last checked" = the newest date a refresh confirmed an entry, not the day this ran.
  const lastChecked = all.map(c => c.checked).filter(Boolean).sort().pop() || today;
  const next = c => (c.deadlines || []).filter(d => d.date >= today).sort((a, b) => a.date < b.date ? -1 : 1)[0];

  // ── JSON-LD: the site + every upcoming event, static in <head>
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": SITE + "/#site", "url": SITE + "/", "name": NAME, "description": DESC, "inLanguage": "en",
        "author": { "@type": "Person", "name": "Yulia Brusova" } },
      { "@type": "ItemList", "name": `Upcoming conferences for academic library professionals`, "numberOfItems": upcoming.length,
        "itemListElement": upcoming.map((c, i) => ({
          "@type": "ListItem", "position": i + 1,
          "item": {
            "@type": "Event", "name": c.name, "startDate": c.dateSort, ...(c.dateEnd ? { "endDate": c.dateEnd } : {}),
            "eventStatus": "https://schema.org/EventScheduled",
            "eventAttendanceMode": MODE[c.format] || MODE.inperson,
            "description": c.description, "url": c.url,
            "organizer": { "@type": "Organization", "name": c.organizer },
            "location": c.format === "virtual" ? { "@type": "VirtualLocation", "url": c.url } : { "@type": "Place", "name": c.location, "address": c.location }
          }
        })) }
    ]
  };
  const ldBlock = `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;

  // ── Plain-HTML list for crawlers (replaced by the app on load)
  let list = `<div class="static-list">\n<p class="static-note">${upcoming.length} upcoming conferences, by month. Last checked ${fmt(lastChecked)}.</p>\n`;
  let month = null;
  for (const c of upcoming) {
    const m = c.dateSort.slice(0, 7);
    if (m !== month) { list += `<h2 class="mh">${monthLabel(c.dateSort)}</h2>\n`; month = m; }
    const d = next(c);
    list += `<article class="card static"><div><h3><a href="${esc(c.url)}">${esc(c.name)}</a></h3>`
      + `<p class="meta"><span class="when">${esc(c.dates)}</span> · ${esc(c.location)} · ${FORMAT[c.format]} · ${esc(c.organizer)}</p>`
      + `<p class="desc">${esc(c.description)}</p>`
      + `<p class="meta">${c.category === "edu" ? "Higher education" : "Academic libraries"} · ${AI[c.aiFocus]}${d ? ` · ${esc(d.what)} ${fmt(d.date)}` : ""}</p></div></article>\n`;
  }
  list += `</div>`;

  let html = readHtml();
  html = replaceBlock(html, "SEO-JSONLD", ldBlock);
  html = replaceBlock(html, "SEO-LIST", list);
  fs.writeFileSync(HTML, html);

  // ── sitemap.xml + robots.txt
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE}/llms.txt</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>
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
  md += `## Upcoming conferences\n\n`;
  month = null;
  for (const c of upcoming) {
    const m = c.dateSort.slice(0, 7);
    if (m !== month) { md += `\n### ${monthLabel(c.dateSort)}\n\n`; month = m; }
    const d = next(c);
    md += `- [${c.name}](${c.url}): ${c.dates}; ${c.location}; ${FORMAT[c.format]}; ${c.organizer}; ${AI[c.aiFocus]}${d ? `; next deadline: ${d.what}, ${fmt(d.date)}` : ""}. ${c.description}\n`;
  }
  md += `\n## Related\n\n- AI for Academic Libraries, a free practitioner curriculum by the same author, mapped to the ACRL AI Competencies: https://ai-for-academic-libraries.vercel.app\n`;
  fs.writeFileSync(path.join(ROOT, "llms.txt"), md);

  if (!quiet) console.log(`SEO: ${upcoming.length} upcoming events → JSON-LD + static list in index.html, sitemap.xml, robots.txt, llms.txt`);
  return upcoming.length;
}

module.exports = { generate };
if (require.main === module) generate();
