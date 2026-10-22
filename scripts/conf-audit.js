// Stage 2 of the refresh workflow — build the fetch plan without touching the network.
//
//   node scripts/conf-audit.js [--stale] [--ids 3,50,52] [--force]
//
// Decides which entries need a look at the live site and packages them into the
// smallest set of fetches that can answer them. Writes scripts/conf-queue.json.
//
//   default   stale rows + a deadline sweep of upcoming rows
//   --stale   stale rows only
//   --ids     just these entry ids, ignoring the cache
//   --force   ignore the cache entirely

const fs = require("fs");
const path = require("path");
const { parse, isPast, isHidden, supersessions } = require("./conf-lib");

const TODAY = new Date().toISOString().slice(0, 10);
const STATE = path.join(__dirname, "conf-state.json");
const QUEUE = path.join(__dirname, "conf-queue.json");

const argv = process.argv.slice(2);
const staleOnly = argv.includes("--stale");
const force = argv.includes("--force");
const idsArg = argv.indexOf("--ids");
const onlyIds = idsArg > -1 ? new Set(argv[idsArg + 1].split(",").map(Number)) : null;

// Aggregator/newsletter pages: fine as a lead, never enough to claim the link
// was verified against the organizer's own site.
const AGGREGATORS = ["librarylearningspace.com", "lislinks.com"];

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { entries: {} };
const list = parse();
// A stale row whose next edition is already tracked needs no research at all —
// conf-dedupe.js reports these, and there is nothing a fetch could add.
const superseded = supersessions(list, TODAY);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "?"; } };

function reasonFor(c) {
  if (isHidden(c)) return "hidden-2025";        // filtered out of the page entirely
  if (isPast(c, TODAY)) return "past";          // over; needs the next edition
  if (!c.urlVerified) return "unverified-url";
  return "deadline-sweep";                      // upcoming: confirm dates + CFP note
}

// A cached answer stays good for a while. "Nothing announced" holds far longer
// than a live listing does — most spring conferences don't publish next year's
// dates until well after the current one ends.
const TTL = { "no-future-edition": 90, resolved: 30, "not-found": 60 };

function cached(c) {
  if (force || onlyIds) return false;
  const s = state.entries[c.id];
  return !!(s && s.recheckAfter && s.recheckAfter > TODAY);
}

const RANK = { "hidden-2025": 0, past: 1, "unverified-url": 2, "deadline-sweep": 3 };

const selected = list
  .map(c => ({ c, reason: reasonFor(c) }))
  .filter(({ c, reason }) => {
    if (onlyIds) return onlyIds.has(c.id);
    if (superseded.has(c.id)) return false;
    if (staleOnly && reason === "deadline-sweep") return false;
    return !cached(c);
  });

// Group by exact URL — that is a real duplicate fetch. Entries sharing only a
// host are noted as siblings so the fetcher can skip a second call when the
// first page already answered them.
const byUrl = new Map();
for (const { c, reason } of selected) {
  if (!byUrl.has(c.url)) byUrl.set(c.url, []);
  byUrl.get(c.url).push({ id: c.id, reason, name: c.name, currentDates: c.dates, dateSort: c.dateSort, deadline: c.deadline });
}

const hostCount = {};
for (const url of byUrl.keys()) hostCount[host(url)] = (hostCount[host(url)] || 0) + 1;

const queue = [...byUrl.entries()]
  .map(([url, entries]) => ({
    url,
    host: host(url),
    lowConfidence: AGGREGATORS.includes(host(url)),
    siblingUrlsOnSameHost: hostCount[host(url)] - 1,
    entries: entries.sort((a, b) => RANK[a.reason] - RANK[b.reason])
  }))
  .sort((a, b) => RANK[a.entries[0].reason] - RANK[b.entries[0].reason] || a.host.localeCompare(b.host));

fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2));

const counts = {};
for (const { reason } of selected) counts[reason] = (counts[reason] || 0) + 1;
console.log(`today ${TODAY} · ${list.length} entries · max id ${Math.max(...list.map(c => c.id))}`);
console.log(`selected ${selected.length}`, counts);
if (!onlyIds) {
  const bits = [`${superseded.size} superseded (next edition already tracked)`];
  if (staleOnly) bits.push(`${list.filter(c => reasonFor(c) === "deadline-sweep").length} upcoming (--stale)`);
  if (!force) bits.push("plus anything still inside cache TTL");
  console.log(`skipped ${list.length - selected.length}: ${bits.join(", ")}`);
}
console.log(`queued ${queue.length} fetches for ${selected.length} entries → ${path.relative(process.cwd(), QUEUE)}`);
console.log(`  (${selected.length - queue.length} fetches saved by grouping shared URLs)`);

module.exports = { TTL };
