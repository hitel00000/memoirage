# Memoirage Context Snapshot (2026-03-30)

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

Current relationship model:
- `links`: directional semantic connections (`derive`, `contradict`, `support`, `related`)
- `evolutions`: directional time/change transitions (`extends`, `shrinks`, `decay`)

Routing model:
- History API routes: `/`, `/capture`, `/processing`, `/storage`
- `404.html` provides static-host fallback and route recovery via `?route=`
- `app.js` normalizes base path from current URL so routing works in root and GitHub Pages subpath deployments
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
- clear in-UI explanation of `inbox` vs `processing`
- toggle note status between `inbox` and `processing`
- edit note content directly
- prepare/delete links before done state
- prepare/delete evolutions before done state
- move to `done`
- soft delete notes
- responsive layout stacks list/detail sections on narrow screens

4. Storage (`/storage`)
- list done notes
- SVG graph rendering of both links and evolutions
- force-directed node layout with cached positions
- add links/evolutions with type dropdown + note text search
- delete links, evolutions, and notes
- responsive layout switches from 3-column desktop grid to stacked mobile sections

## Data model notes

- IndexedDB version is `2`
- Stores: `notes`, `links`, `evolutions`
- Migration (`v1 -> v2`) remaps old link types:
  - `supports -> support`
  - `contrasts -> contradict`
  - `depends_on -> derive`
  - `duplicates -> related`
- Firestore mode mirrors the same `links` + `evolutions` API surface

## PWA alignment

- `manifest.json` is configured for SPA start (`./`)
- `sw.js` precaches SPA files and fallback page (cache name: `memoirage-static-v9`)
- app registers service worker from `app.js`

## Current priorities

- Improve graph readability for larger datasets
- Add app update notification UX for new cache versions
- Keep Firestore mode optional and documented
