# Memoirage Context Snapshot (2026-03-27)

## Product stance

- Serverless runtime: static files only
- Offline-first default: IndexedDB
- Deploy target: static hosting, including GitHub Pages

## Current runtime model

Memoirage now uses a single-page app shell:
- `index.html`: SPA entry
- `app.js`: route handling + page logic
- `app.css`: shared SPA styles
- `db.js`: storage abstraction

Routing model:
- History API routes: `/`, `/capture`, `/processing`, `/storage`
- Legacy pages (`capture.html`, `processing.html`, `graph.html`) redirect to SPA paths
- `404.html` provides static-host fallback and route recovery via `?route=`

## Repository layout

```text
memoirage/
|- 404.html
|- app.css
|- app.js
|- db.js
|- index.html
|- capture.html
|- processing.html
|- graph.html
|- manifest.json
|- sw.js
|- favicon.svg
|- icon-192.png
`- icon-512.png
```

## Feature flow

1. Home (`/`)
- dashboard + quick navigation
- workspace note counters

2. Capture (`/capture`)
- quick note creation
- save into `status: inbox`

3. Processing (`/processing`)
- review inbox notes
- move to `processing` or `done`
- soft delete notes

4. Storage (`/storage`)
- list done notes
- SVG graph rendering of note links
- add/delete links and delete notes

## PWA alignment

- `manifest.json` is configured for SPA start (`./`)
- `sw.js` precaches SPA files and compatibility files
- app registers service worker from `app.js`

## Current priorities

- Improve graph readability for larger datasets
- Add app update notification UX for new cache versions
- Keep Firestore mode optional and documented
