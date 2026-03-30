# Memoirage

Memoirage is an offline-first PWA for capturing and organizing personal notes.
The app runs as a single-page application (SPA) with History API routing.

## Project Context

- Canonical execution context: `CONTEXT.md`
- Initial design archive: `CONTEXT.orig.md`
- If they conflict, use `CONTEXT.md` for implementation decisions

## Architecture

- Runtime: serverless static app (no dedicated API server)
- App model: SPA + History API routes
- Storage: IndexedDB by default via `db.js`
- Optional extension: Firestore adapter in `db.js`
- Frontend: `index.html` + `app.js` + `app.css`

Decision boundary:
- Previous Node/Express + SQLite + REST design is treated as historical context
- Current runtime contract is the client data API exported from `db.js`
- Offline-first usage must work without backend infrastructure

## Routes

- `/` -> Home
- `/capture` -> Capture
- `/processing` -> Processing Queue
- `/storage` -> Storage
- GitHub Pages subpath example: `/<repo-name>/capture/`

Static-host fallback:
- `404.html` redirects unknown paths to `index.html?route=...`
- `app.js` restores route from query and normalizes base path for both root and subpath deployments
- `capture/`, `processing/`, `storage/` route entry pages redirect to SPA shell (for simple static servers like `python -m http.server`)

## Product Flow

Processing behavior:
- shows both `inbox` and `processing` notes
- explains role difference: `inbox` (unreviewed) vs `processing` (active refinement)
- allows toggling between `inbox` <-> `processing`
- supports editing note content directly in processing detail
- supports preparing directional links before notes are done
- supports preparing note evolutions before notes are done
- allows moving notes to `done`
- includes fast list filtering with consistent query syntax:
  - free text: `idea`
  - tag: `#research` or `tag:research`
  - status: `status:inbox`, `status:processing`, `status:done`

Connection model:
- Link types are normalized to: `derive`, `contradict`, `support`, `related`
- Evolution types: `extends`, `shrinks`, `decay`
- IndexedDB migration (`v1 -> v2`) remaps legacy link types:
  - `supports -> support`
  - `contrasts -> contradict`
  - `depends_on -> derive`
  - `duplicates -> related`

Storage graph behavior:
- renders links and evolutions together in the graph
- uses force-directed positioning and resets cached node positions when data changes
- uses different edge styles for links vs evolutions

Tag behavior:
- tags are auto-extracted from note content hashtags (for example: `#ai`, `#daily-log`)
- list items surface tag chips so query terms are easier to discover

Responsive layout behavior:
- Processing page switches to stacked layout on narrow screens
- Storage page switches from 3-column desktop grid to stacked mobile sections (list -> graph -> detail)

## Domain Model (Current)

- Primary entities: `notes`, `links`, `evolutions`
- Note lifecycle: `inbox` -> `processing` -> `done` -> `deleted` (soft delete)
- IndexedDB schema version: `2`
- Migration support: legacy link-type remapping (`v1 -> v2`)

## Repository Layout

```text
memoirage/
|- 404.html
|- CONTEXT.md
|- CONTEXT.orig.md
|- README.md
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

## Local Run

1. Start a static server:

```bash
python -m http.server 8000
```

2. Open:
- `http://localhost:8000/`

## Data Layer (`db.js`)

Default: `IndexedDBStore`
- object stores: `notes`, `links`, `evolutions`
- filters by status/tag/query
- soft delete support

Optional: `FirestoreStore`
- enable with `setConfig({ useFirestore: true })`
- requires Firebase SDK from host

When to use Firestore mode:
- Use it only when cross-device sync is needed
- Keep IndexedDB as the default for offline-first local reliability
- Treat Firestore as an optional adapter, not a required runtime dependency

Firestore quick setup (host page):
1. Load Firebase Auth + Firestore SDK before `db.js`
2. Initialize Firebase app in the host page
3. Call `setConfig({ useFirestore: true })` before `initDB()`
4. Ensure anonymous auth is enabled (current implementation signs in anonymously)

Current limitations:
- This repository does not bundle Firebase SDK by default in `index.html`
- Firestore mode expects global `firebase` object from the host environment
- If SDK/auth is unavailable, keep `useFirestore: false` (IndexedDB mode)

Public API:
- `initDB`, `saveNote`, `getNotes`, `getNoteById`, `updateNote`, `deleteNote`
- `saveLink`, `getLinks`, `deleteLink`
- `saveEvolution`, `getEvolutions`, `deleteEvolution`
- `clearDB`
- `setConfig`, `getConfig`

## PWA / Offline

- `manifest.json` uses relative URLs
- `sw.js` precaches SPA assets and fallback page (`memoirage-static-v9`)
- Service worker is registered by `app.js`
- Core behavior must remain usable in IndexedDB-only mode

## GitHub Pages

1. Push repository
2. `Settings -> Pages`
3. Source: `main` / root
4. Open published URL:
- `https://<username>.github.io/<repo-name>/`

## Roadmap Priorities

P1 (current focus):
- Improve graph layout quality for larger note sets
- Add app update prompt UX for service worker cache updates
- Keep Firestore mode optional and documented

P2:
- Improve tag/search ergonomics in UI and `db.js` usage patterns

P3:
- Add attachments and cluster/membership model incrementally

P4:
- Add optional AI refine/merge support with graceful fallback

## Feature Acceptance Rule

Every new feature should satisfy all:
- Works in offline-first IndexedDB mode
- Does not require backend infrastructure
- Fits current SPA + `db.js` runtime contract
