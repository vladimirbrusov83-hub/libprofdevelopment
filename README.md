# Professional Development — AI for Academic Libraries

A filterable directory of AI-focused conferences and professional development for academic library workers, aligned with the [ACRL AI Competencies](https://www.ala.org/acrl/standards/ai). Compiled by Yulia Brusova.

Part of [AI for Academic Libraries](https://ai-for-academic-libraries.vercel.app).

## What's in it

138 conferences, webinars and events (in-person, virtual and hybrid). For each one you see the dates, location, format, organizer, a short description, any submission deadline, and a link to the official site.

You can:

- **Search** by name, organizer or topic
- **Filter** by audience (Academic Libraries or Higher Education), status (Upcoming or Past), 100% AI focus, Virtual / Hybrid, and International
- **Read the AI focus label** on each event: entirely about AI, has a major AI track, or a general conference listed for completeness

Events move from "Upcoming" to "Past" on their own once their end date passes, so the list stays correct without manual edits.

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
  deadline: "Registration open"  // optional
}
```

After editing, update the "Last updated" date in the footer.

## License

© 2026 Iuliia Brusova. Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
