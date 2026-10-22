// Stage B — a model reads the saved page text and fills in a fixed form, with an
// exact quote and page number for every date. Runs headless Claude Code
// (`claude -p`) on your own login: Haiku by default, Sonnet for re-checks.
//
//   node scripts/conf-extract.js --ids 31,40,107            # Haiku
//   node scripts/conf-extract.js --ids 107 --model sonnet   # escalation
//
// Input:  scripts/pages/<id>/*.txt (from conf-fetch)
// Output: scripts/pages/<id>/extract.json — checked by conf-verify, never applied directly.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { parse } = require("./conf-lib");
const { DEADLINE_TYPES, readManifest, pageDir, loadPages } = require("./conf-pages");

const argv = process.argv.slice(2);
const arg = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const MODEL = arg("--model") || "haiku";
const CONCURRENCY = Number(arg("--jobs") || 6);
const MAX_CHARS = 60000; // per conference, across its pages
const TODAY = new Date().toISOString().slice(0, 10);

const manifest = readManifest();
const ids = arg("--ids")
  ? arg("--ids").split(",").map(Number)
  : Object.keys(manifest).filter(id => manifest[id].verdict === "ok").map(Number);
const list = parse();

const quoted = { type: "object", properties: { quote: { type: "string" }, page: { type: "integer" } }, required: ["quote", "page"] };
const SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["found", "no-future-edition", "not-stated"] },
    edition: {
      type: ["object", "null"],
      properties: {
        name: { type: "string" },
        start: { type: "string", description: "YYYY-MM-DD" },
        end: { type: ["string", "null"], description: "YYYY-MM-DD last day, null if one day" },
        location: { type: "string" },
        format: { type: "string", enum: ["inperson", "virtual", "hybrid"] },
        ...quoted.properties
      },
      required: ["name", "start", "end", "location", "format", "quote", "page"]
    },
    deadlines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: Object.keys(DEADLINE_TYPES) },
          label: { type: "string", description: "short English card label using the page's own words, max 5 words, e.g. 'Breakout proposals due', 'Author registration closes'" },
          date: { type: "string", description: "YYYY-MM-DD" },
          ...quoted.properties
        },
        required: ["type", "date", "quote", "page"]
      }
    },
    ai: {
      type: ["object", "null"],
      properties: { level: { type: "string", enum: ["ai100", "aibig"] }, ...quoted.properties },
      required: ["level", "quote", "page"]
    }
  },
  required: ["status", "edition", "deadlines", "ai"]
};

const SYSTEM = `You extract conference facts from saved web page text. You never guess.
Today is ${TODAY}.

Rules:
- "edition" = the next edition that has NOT ended yet (the current one if it is still ahead or running; otherwise the next one). If the pages announce no such edition, status "no-future-edition" and edition null. If the pages are unrelated or say nothing about dates, status "not-stated".
- Every "quote" must be copied character-for-character from the page text (a short span, under 200 characters) and must itself contain the date it supports, with the month and day. Give the page number [P#] it came from.
- For deadlines, quote the whole line or table row so the quote also contains the words that say WHAT is due (e.g. "Early Bird Registration extended to October 23!", not just "October 23").
- edition.quote must contain the start date (and the end day for multi-day events).
- deadlines: only dated, actionable deadlines for that edition that are on or after today: proposals/CFP, papers, posters/demos, early-bird rate end, regular/standard rate end, registration close, scholarship/travel-grant applications. Pick the type whose meaning matches the quote's own words: a "Regular" rate period ending is regular_rate_ends, NOT early_bird_ends; "register by X to save" is discount_ends. Skip deadlines already past, rolling/"TBA" items, and dates you would have to infer.
- If a rate table gives a period like "Regular (September 24-October 23)", the deadline date is the END of the period.
- ai: "ai100" only if the whole event is about AI; "aibig" only if the pages explicitly name an AI theme, track or strand. Otherwise null. Quote the words.
- If something is not on the pages, leave it out. An empty deadlines array is a fine answer.`;

function prompt(c, pages) {
  let budget = MAX_CHARS;
  const body = pages.map(p => {
    const t = p.text.slice(0, Math.max(0, budget));
    budget -= t.length;
    return `[P${p.n}] ${p.url}\n${t}`;
  }).join("\n\n----------\n\n");
  return `Conference as currently listed:
name: ${c.name}
organizer: ${c.organizer}
dates: ${c.dates} (start ${c.dateSort}${c.dateEnd ? ", end " + c.dateEnd : ""})
location: ${c.location} · format: ${c.format}

Saved pages:

${body}`;
}

function runClaude(input) {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", [
      "-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
      "--setting-sources", "", "--system-prompt", SYSTEM,
      "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("close", code => {
      try {
        const j = JSON.parse(out);
        if (j.is_error || !j.structured_output) return reject(new Error(j.result || "no structured output"));
        resolve({ data: j.structured_output, cost: j.total_cost_usd || 0 });
      } catch { reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`)); }
    });
    p.stdin.end(input);
  });
}

(async () => {
  const todo = ids.map(id => list.find(c => c.id === id)).filter(c => c && manifest[c.id] && manifest[c.id].verdict === "ok");
  let i = 0, cost = 0, failed = 0;
  async function worker() {
    while (i < todo.length) {
      const c = todo[i++];
      const pages = loadPages(c.id);
      try {
        const { data, cost: usd } = await runClaude(prompt(c, pages));
        cost += usd;
        const out = { id: c.id, model: MODEL, extractedAt: TODAY, pages: pages.map(p => p.url), ...data };
        fs.writeFileSync(path.join(pageDir(c.id), "extract.json"), JSON.stringify(out, null, 2));
        console.log(`#${c.id}`.padEnd(5), data.status.padEnd(17), `${data.deadlines.length} deadline(s)`, c.name.slice(0, 45));
      } catch (e) {
        failed++;
        console.log(`#${c.id}`.padEnd(5), "ERROR", e.message.slice(0, 120));
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n${todo.length - failed} extracted with ${MODEL}, ${failed} failed · ~$${cost.toFixed(3)} at list price (billed to your Claude plan)`);
})();
