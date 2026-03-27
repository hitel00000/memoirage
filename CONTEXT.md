# Memoirage Context Snapshot (2026-03-27)

## Product stance

- Serverless runtime: static files only
- Offline-first default: IndexedDB
- Deploy target: static hosting, including GitHub Pages

## Current runtime model

Memoirage uses a single-page app shell:
- `index.html`: SPA entry
- `app.js`: route handling + feature logic
- `app.css`: shared SPA styles
- `db.js`: storage abstraction

Routing model:
- History API routes: `/`, `/capture`, `/processing`, `/storage`
- `404.html` provides static-host fallback and route recovery via `?route=`
- route entry pages (`capture/`, `processing/`, `storage/`) redirect into SPA shell for local static servers

## Repository layout

```text
memoirage/
|- 404.html
|- app.css
|- app.js
|- capture/
|- db.js
|- index.html
|- manifest.json
|- processing/
|- storage/
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
- review both `inbox` and `processing` notes
- toggle note status between `inbox` and `processing`
- move to `done`
- soft delete notes

4. Storage (`/storage`)
- list done notes
- SVG graph rendering of note links
- add links with relation dropdown + note text search
- delete links and notes

## PWA alignment

- `manifest.json` is configured for SPA start (`./`)
- `sw.js` precaches SPA files and fallback page
- app registers service worker from `app.js`

## Current priorities

- Improve graph readability for larger datasets
- Add app update notification UX for new cache versions
- Keep Firestore mode optional and documented
