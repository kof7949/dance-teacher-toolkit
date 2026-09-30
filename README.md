# Dance Teacher Toolkit

A phone-first PWA (installable web app) with two tools for dance instructors:

- **Music & Count** — load a song, slow it down without changing pitch (50–100% speed), mark a loop region to drill a section, and tag counts (1–8 or custom labels) to specific timestamps.
- **Progress Tracker** — per-student skill checklist (Turns, Leaps & Jumps, Flexibility, Technique, Performance), a running history log, and a one-tap shareable summary.

All data (songs, students, progress, tags) is stored **locally on-device** via IndexedDB — no account, no server, no internet required once loaded.

## Run it locally

```bash
node tools/serve.js 8080
```

Then open `http://localhost:8080` in a browser.

## Test on your Android phone (same Wi-Fi)

1. Find your PC's local IP address (Windows: `ipconfig`, look for "IPv4 Address").
2. Run the server as above.
3. On your phone (same Wi-Fi network), open `http://<your-pc-ip>:8080` in Chrome.

Note: over plain HTTP, the app works fully, but Android won't offer the "Install app" banner or offline caching (those require HTTPS). You can still add it to your home screen manually via Chrome's menu → "Add to Home screen".

## Getting a real installable `.apk`

This machine doesn't have Android Studio/SDK installed, so the path that needs no heavy local install is:

1. **Deploy the app to a free HTTPS static host** — e.g. GitHub Pages, Netlify, Vercel, or Cloudflare Pages (any of these can serve this folder as-is, no build step needed).
2. Visit that HTTPS URL on your Android phone — Chrome will offer to install it directly as a home-screen app (this alone may be enough for daily use).
3. To get an actual `.apk` file you can install without deploying (e.g. to share with other instructors), go to **[pwabuilder.com](https://www.pwabuilder.com)**, paste your deployed HTTPS URL, and it will generate a signed Android package for you to download and sideload — no Android Studio required.

I can help set up the hosting step (e.g. push this to a GitHub repo and enable Pages) whenever you're ready — just let me know which host you'd prefer, or if you already have a GitHub/Netlify account.

## Project structure

- `index.html`, `css/`, `js/` — the app
- `manifest.json`, `sw.js` — PWA install + offline support
- `icons/` — app icons (placeholder — swap these for real artwork anytime)
- `tools/serve.js` — zero-dependency local dev server
- `tools/make-icons.js` — regenerates placeholder icons
- `tools/make-test-audio.js` + `test-assets/count-test.wav` — synthetic 8-count test clip for quickly sanity-checking the Music & Count screen
