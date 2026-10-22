// One command for the whole evidence pipeline:
//   download pages → Haiku extracts → script verifies → Sonnet re-reads only the
//   conferences that failed a check → verify again → ops ready for conf-apply.
//
//   node scripts/conf-run.js --ids 31,40,107
//   node scripts/conf-run.js --queue          # whatever conf-audit queued
//
// Nothing here writes index.html. Review scripts/conf-updates.json and
// scripts/pages/review.json, then: node scripts/conf-apply.js scripts/conf-updates.json --footer "<today>"

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { PAGES, pageDir } = require("./conf-pages");

const argv = process.argv.slice(2);
const sel = argv.includes("--queue") ? ["--queue"] : ["--ids", argv[argv.indexOf("--ids") + 1]];
const node = (script, args) => execFileSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: "inherit" });

console.log("── 1/4 download pages");
node("conf-fetch.js", sel);
const manifest = JSON.parse(fs.readFileSync(path.join(PAGES, "manifest.json"), "utf8"));
const ids = sel[0] === "--ids" ? sel[1].split(",") : Object.keys(manifest);
const okIds = ids.filter(id => manifest[id] && manifest[id].verdict === "ok");

console.log("\n── 2/4 extract with Haiku");
if (okIds.length) node("conf-extract.js", ["--ids", okIds.join(",")]);

console.log("\n── 3/4 verify");
node("conf-verify.js", ["--ids", ids.join(",")]);

const failed = JSON.parse(fs.readFileSync(path.join(PAGES, "review.json"), "utf8")).filter(r => r.kind === "failed").map(r => String(r.id));
if (failed.length) {
  console.log(`\n── 4/4 Sonnet re-reads ${failed.length} that failed: #${failed.join(", #")}`);
  for (const id of failed) {
    const f = path.join(pageDir(id), "extract.json");
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(pageDir(id), "extract.haiku.json"));
  }
  node("conf-extract.js", ["--ids", failed.join(","), "--model", "sonnet", "--jobs", "4"]);
  node("conf-verify.js", ["--ids", ids.join(",")]);
} else console.log("\n── 4/4 nothing failed, no Sonnet needed");
