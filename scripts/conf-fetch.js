// Stage A — download organizer pages as plain text. No model involved, so
// nothing is paraphrased: the extractor and the verifier both read exactly
// these files. Also decides blocked / not-found from real status codes.
//
//   node scripts/conf-fetch.js --ids 31,40,107     # specific entries
//   node scripts/conf-fetch.js --queue             # everything in scripts/conf-queue.json
//
// Writes scripts/pages/<id>/<n>.txt and scripts/pages/manifest.json (gitignored).

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { parse } = require("./conf-lib");
const { PAGES, MANIFEST, htmlToText, candidateLinks, readManifest, pageDir } = require("./conf-pages");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CONCURRENCY = 8;
const MIN_TEXT = 400; // shorter than this = a JS shell or an error page

const argv = process.argv.slice(2);
const list = parse();
let ids;
if (argv.includes("--ids")) ids = argv[argv.indexOf("--ids") + 1].split(",").map(Number);
else if (argv.includes("--queue")) ids = [...new Set(require("./conf-queue.json").flatMap(q => q.entries.map(e => e.id ?? e)))];
else { console.error("usage: node scripts/conf-fetch.js --ids 1,2,3 | --queue"); process.exit(1); }

const state = fs.existsSync(path.join(__dirname, "conf-state.json")) ? require("./conf-state.json").entries : {};

async function viaFetch(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    redirect: "follow", signal: AbortSignal.timeout(20000)
  });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

// Each Chrome run gets its own profile dir: parallel runs sharing one profile
// hand off to each other and come back empty. The longer time budget lets
// bot-check interstitials finish before the DOM is dumped.
function viaChrome(url) {
  const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "conf-chrome-"));
  return new Promise(resolve => {
    execFile(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, "--virtual-time-budget=15000", "--dump-dom", url],
      { timeout: 60000, maxBuffer: 32 << 20 }, (err, stdout) => {
        fs.rmSync(profile, { recursive: true, force: true });
        resolve(err ? null : stdout);
      });
  });
}

// One URL → { url, status, chars, method, html, text } (html kept in memory only)
async function grab(url) {
  let r = { url, status: 0, method: "fetch", html: "", text: "" };
  try {
    const f = await viaFetch(url);
    r = { ...r, status: f.status, html: f.html, url: f.finalUrl || url };
    r.text = f.status < 400 ? htmlToText(f.html) : "";
  } catch (e) { r.error = String(e.cause?.code || e.name || e); }
  if (r.status === 404 || r.status === 410) return r;
  if (r.text.length < MIN_TEXT) {
    const dom = await viaChrome(url);
    if (dom) {
      const text = htmlToText(dom);
      // Chrome has no status code; a long page is a real page, a short one stays a failure.
      if (text.length > r.text.length) r = { ...r, method: "chrome", html: dom, text, status: text.length >= MIN_TEXT ? 200 : r.status };
    }
  }
  return r;
}

async function fetchEntry(c) {
  const dir = pageDir(c.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const known = (state[c.id] && state[c.id].sources) || [];
  const main = await grab(c.url);
  const pages = [main];
  if (main.text.length >= MIN_TEXT) {
    const links = candidateLinks(main.html, main.url).map(l => l.url);
    const extra = [...new Set([...known, ...links])].filter(u => u !== main.url).slice(0, 4);
    for (const u of extra) pages.push(await grab(u));
  }
  const saved = pages.map((p, n) => {
    const ok = p.text.length >= MIN_TEXT;
    if (ok) fs.writeFileSync(path.join(dir, `${n}.txt`), p.text);
    return { url: p.url, status: p.status, chars: p.text.length, method: p.method, ...(p.error ? { error: p.error } : {}), ...(ok ? { file: `${n}.txt` } : {}) };
  });
  const okMain = saved[0].file;
  const verdict = okMain ? "ok" : (main.status === 404 || main.status === 410 || main.error === "ENOTFOUND") ? "not-found" : "blocked";
  return { verdict, fetchedAt: new Date().toISOString().slice(0, 10), pages: saved };
}

(async () => {
  fs.mkdirSync(PAGES, { recursive: true });
  const manifest = readManifest();
  const todo = ids.map(id => list.find(c => c.id === id)).filter(Boolean);
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const c = todo[i++];
      manifest[c.id] = await fetchEntry(c);
      const m = manifest[c.id];
      console.log(`#${c.id}`.padEnd(5), m.verdict.padEnd(9), `${m.pages.filter(p => p.file).length}/${m.pages.length} pages`, c.name.slice(0, 50));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  const v = todo.map(c => manifest[c.id].verdict);
  console.log(`\n${v.filter(x => x === "ok").length} ok · ${v.filter(x => x === "blocked").length} blocked · ${v.filter(x => x === "not-found").length} not-found → ${path.relative(process.cwd(), MANIFEST)}`);
})();
