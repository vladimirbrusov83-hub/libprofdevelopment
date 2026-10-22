// Stage 1 of the refresh workflow — the free one.
//
//   node scripts/conf-dedupe.js [--write <updates.json>]
//
// Many stale rows need no research at all: a later edition of the same
// conference series is already sitting in the array. Finding those costs
// nothing, so it runs before anything touches the network.

const fs = require("fs");
const path = require("path");
const { parse, isPast, isHidden, supersessions } = require("./conf-lib");

const TODAY = new Date().toISOString().slice(0, 10);

const list = parse();
const sup = supersessions(list, TODAY);

const superseded = [];   // stale, but a later edition is already tracked
const research = [];     // stale with no later sibling — Stage 2 has to look

for (const c of list) {
  if (!isPast(c, TODAY)) continue;
  const later = sup.get(c.id);
  if (later) superseded.push([c, later]);
  else research.push(c);
}

console.log(`today ${TODAY} · ${list.length} entries`);
console.log(`superseded by an edition already tracked: ${superseded.length}`);
for (const [c, s] of superseded) {
  console.log(`  #${c.id} ${c.dateSort} ${c.name.slice(0, 52)}  ->  #${s.id} ${s.dateSort}`);
}
console.log(`still need research: ${research.length} (${research.filter(isHidden).length} of them dated 2025 and invisible)`);

const wi = process.argv.indexOf("--write");
if (wi > -1) {
  const out = process.argv[wi + 1] || path.join(__dirname, "conf-updates.json");
  // A superseded row is dropped only when it is invisible anyway (2025). A past
  // 2026 row still renders with a Past badge, which is real history worth keeping.
  const ops = superseded
    .filter(([c]) => isHidden(c))
    .map(([c, s]) => ({ id: c.id, drop: true, note: `superseded by #${s.id} (${s.dateSort}); 2025 rows are filtered out of the page` }));
  fs.writeFileSync(out, JSON.stringify(ops, null, 2));
  console.log(`wrote ${ops.length} drop ops → ${path.relative(process.cwd(), out)}`);
}
