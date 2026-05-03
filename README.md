# mikeandxan

Wedding website for Michael & Alexandria — Saturday, November 14, 2026, at The Thompson Barn in Lenexa, KS.

Live at [mikeandxan.com](https://mikeandxan.com) (DNS pending).

## Stack

- Plain HTML / CSS / vanilla JS, no build step.
- Hosted on **GitHub Pages** from `main`.
- RSVP backend: **Google Apps Script** (reads/writes the master Google Sheet, sends a notification email per submission).
- Photo gallery (later): **Cloudinary** with AI moderation.

## Files

- `index.html` — single-page site with all sections
- `style.css` — mobile-first responsive styles
- `script.js` — nav toggle + RSVP form logic

## Local preview

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.
