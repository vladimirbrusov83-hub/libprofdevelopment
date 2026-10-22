// Regression checks for the evidence pipeline's pure functions. Run:
//   node scripts/tests/verify-regressions.js
// Each case is a real mistake (or near-miss) we don't want back.

const { quoteHasDate, context, norm, DEADLINE_TYPES } = require("../conf-pages");

const charlestonRates = [
  "Extra Early Bird (June 11-July 10) | $535 | n/a |",
  "Early Bird (July 11- September 18 )",
  "Extended to September 23 | $555 | $390 |",
  "Regular (September 24-October 23) | $695 | $450 |",
  "Late/On Site (November 2-6) | $850 | n/a |"
].join("\n");

const typeOk = (page, quote, type) => DEADLINE_TYPES[type].words.test(context(page, quote));

const cases = [
  // Oct 23 is real but it ends the REGULAR rate — must not pass as early bird.
  ["Charleston Oct 23 filed as early_bird_ends is rejected", !typeOk(charlestonRates, "Regular (September 24-October 23)", "early_bird_ends")],
  ["Charleston Oct 23 as regular_rate_ends passes", typeOk(charlestonRates, "Regular (September 24-October 23)", "regular_rate_ends") && quoteHasDate("Regular (September 24-October 23)", "2026-10-23")],
  ["Charleston early bird is Sept 23, not Oct 23", quoteHasDate("Extended to September 23", "2026-09-23") && !quoteHasDate("Extended to September 23", "2026-10-23")],
  ["a bare date quote can't carry a type by itself", !typeOk("Posters & demos\n9 Nov 2026", "9 Nov 2026", "posters_due")],
  ["date ranges with 'to'", quoteHasDate("Join us this March 16 to 18 in Arlington, VA", "2027-03-18")],
  ["European numeric ranges", quoteHasDate("22.-25.6.2027 in Nürnberg", "2027-06-22")],
  ["US numeric range end", quoteHasDate("(1/16-3/14/27)", "2027-03-14")],
  ["wrong year rejected", !quoteHasDate("Oct 23, 2025", "2026-10-23")],
  ["month alone isn't a date", !quoteHasDate("March 2027", "2027-03-02")],
  ["curly quotes and dashes normalize", norm("Author’s registration – May 10") === "author's registration-may 10"]
];

let bad = 0;
for (const [name, ok] of cases) { if (!ok) bad++; console.log(ok ? "pass" : "FAIL", name); }
console.log(`\n${cases.length - bad}/${cases.length} passed`);
process.exit(bad ? 1 : 0);
