# Memoirage

Memoirage is an offline-first PWA for capturing and organizing personal notes.
The app runs as a single-page application (SPA) with History API routing.

## Architecture

- Runtime: static hosting friendly (no dedicated API server)
- Storage: IndexedDB by default (`db.js`)
- Optional storage extension: Firestore mode in `db.js`
- Frontend: SPA shell (`index.html`) + route logic (`app.js`) + styles (`app.css`)

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

Processing behavior:
- shows both `inbox` and `processing` notes
- explains role difference: `inbox` (unreviewed) vs `processing` (active refinement)
- allows toggling between `inbox` <-> `processing`
- supports editing note content directly in processing detail
- supports preparing links before notes are done
- allows moving notes to `done`

Storage link behavior:
- relation type is selected via dropdown
- target note is searched with text input (datalist suggestions)

Responsive layout behavior:
- Processing page switches to stacked layout on narrow screens
- Storage page switches from 3-column desktop grid to stacked mobile sections (list -> graph -> detail)

## Repository Layout

```text
memoirage/
|- 404.html
|- CONTEXT.md
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
- object stores: `notes`, `links`
- filters by status/tag/query
- soft delete support

Optional: `FirestoreStore`
- enable with `setConfig({ useFirestore: true })`
- requires Firebase SDK from host

Public API:
- `initDB`, `saveNote`, `getNotes`, `getNoteById`, `updateNote`, `deleteNote`
- `saveLink`, `getLinks`, `deleteLink`, `clearDB`
- `setConfig`, `getConfig`

## PWA / Offline

- `manifest.json` uses relative URLs
- `sw.js` precaches SPA assets and fallback page (`memoirage-static-v8`)
- Service worker is registered by `app.js`

## GitHub Pages

1. Push repository
2. `Settings -> Pages`
3. Source: `main` / root
4. Open published URL:
- `https://<username>.github.io/<repo-name>/`

## Next Improvements

- Improve graph layout quality for larger note sets
- Add cache update prompt UX
- Expand Firestore setup guide and auth examples
