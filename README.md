# Professional Development for Academic Libraries

A filterable directory of conferences and professional development for academic library and higher-education workers, with every event rated for its AI content (ratings informed by the [ACRL AI Competencies](https://www.ala.org/acrl/standards/ai)). Compiled by Yulia Brusova.

Live: https://libprofdevelopment.vercel.app

## What's in it

130 conferences, webinars and events (in-person, virtual and hybrid). The page opens on upcoming events.

- **Closing soon:** every proposal, registration and early-bird deadline in the next 30 days, at the top of the page
- **At a glance:** upcoming events, events starting in the next 30 days, deadlines in the next 30 days, and events that are 100% about AI
- **On each card:** dates, location, format, organizer, a short description, the next deadline with a countdown, the date the organizer's site was last checked, an **Add to calendar** button (.ics) and a link to the official site
- **AI focus label:** 100% AI Focus, Major AI Track, or "AI varies" for general conferences
- **Search** by name, organizer or topic, and **filter** in the side panel by date (Upcoming, Past, All), audience, AI focus (100% AI, Major AI track, AI varies), virtual/hybrid and outside the U.S., with live counts; sort by event date or next deadline

Events move from "Upcoming" to "Past" on their own once their end date passes.

## How it's built

One self-contained `index.html` file: plain HTML, CSS and JavaScript, with no build step and no dependencies apart from Google Fonts. All conference data lives in the `CONFERENCES` array inside the file.

To view it, open `index.html` in a browser. To host it, deploy the repo to any static host (Vercel, GitHub Pages, Netlify).

## Updating the list

Edit the `CONFERENCES` array in `index.html`. Each entry looks like this:

```js
{
  id: "unique-id",
  name: "Conference Name",
  organizer: "Organization",
  dates: "March 3–6, 2027",      // shown to readers
  dateSort: "2027-03-03",        // start date, used for sorting
  dateEnd: "2027-03-06",         // optional: keeps multi-day events "Upcoming" until they end
  location: "City, State",
  format: "inperson",            // inperson | virtual | hybrid
  url: "https://...",
  urlVerified: true,
  urlNote: "...",                // optional: shown when urlVerified is false
  category: "lib",               // lib (academic libraries) | edu (higher education)
  aiFocus: "ai100",              // ai100 (all AI) | aibig (major AI track) | aisig (included for completeness)
  international: false,
  description: "...",
  deadline: "Registration open",  // optional free-text status note
  deadlines: [                    // optional dated deadlines: drive "Closing soon" and the card countdown
    { date: "2026-11-30", what: "Proposals due" }
  ],
  checked: "2026-10-22"           // set by the refresh script when the organizer's site was confirmed
}
```

After editing, update both "Last updated" dates (under the heading and in the footer).

The `scripts/` folder holds the refresh tooling (`conf-lib`, `conf-dedupe`, `conf-audit`, `conf-apply`, the evidence pipeline `conf-run`, the local approval page `conf-report` (each proposed change beside the line of the organizer's page it came from; approved changes go through `conf-apply`), and `conf-seo`, which regenerates sitemap.xml, robots.txt, llms.txt and the crawler-readable copy after every data change). It is kept out of the live site by `.vercelignore`.

## License

© 2026 Iuliia Brusova. Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
