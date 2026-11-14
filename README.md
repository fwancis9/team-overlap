# Team Overlap

A simple page for finding a meeting time that fits everyone's preferred hours.

Each person sets the hours they like to meet, and the page shows when those hours overlap. It works for any team, even one where everyone shares a time zone. Different time zones are a bonus: each person's hours are read in their own local time, so it also works across countries.

**Live:** https://fwancis9.github.io/team-overlap/

## What it does

- **Right now**: a live clock for each person, showing their local time, day and preferred hours, and whether it's a good time or outside hours.
- **Plan a meeting**: pick a date and a meeting length, then step Earlier or Later 30 minutes at a time. Each person's local time and status update as you go. *Find earliest best time for all* jumps to the soonest slot with the fewest outside-hours minutes.
- **Day at a glance**: a grid of today in your own time zone, with one row per person and one cell per half hour.

Daylight saving is handled automatically. Light and dark mode follow your device settings.

## Editing the team

Everything is set at the top of `script.js`:

```js
const DEFAULT_HOURS = [{ start: 9 * 60, end: 23 * 60 }]; // minutes after local midnight

const PEOPLE = [
  { name: "Gage", zone: "America/Denver" },
  {
    name: "Marc",
    zone: "Asia/Manila",
    hours: {
      weekday: [{ start: 20 * 60, end: 23 * 60 }],
      weekend: [{ start: 13 * 60, end: 23 * 60 }]
    }
  }
];
```

- `zone` is an [IANA time zone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- `hours` is optional. Anyone without it uses `DEFAULT_HOURS`.
- Hours are in that person's own local time. Weekends are Saturday and Sunday in their own time zone.

## Running locally

It's plain HTML, CSS and JavaScript, with no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

## Deploying

GitHub Pages serves the `main` branch root. Pushing to `main` publishes the site.
