# PKM Context Snapshot (2026-03-27)

## Product stance

- Serverless at app runtime: no dedicated API server required.
- Offline-first by default: IndexedDB is the primary storage.
- Deploy target: static hosting first, especially GitHub Pages project path deployment.

## Repository layout (GitHub Pages friendly)

All runtime files are in repository root:

```
pkm/
├── db.js
├── index.html
├── capture.html
├── processing.html
├── graph.html
├── manifest.json
├── sw.js
├── icon-192.png
└── icon-512.png
```

Rationale:
- GitHub Pages project URLs include a subpath (`/repo-name/`).
- Root-absolute routes (`/index.html`, `/db.js`) break in that environment.
- App now uses relative paths (`./...`) to stay portable across local static servers and Pages.

## Runtime flow

1. Capture (`capture.html`)
   - Quick note input
   - Save as `status: inbox`
2. Processing (`processing.html`)
   - Load inbox notes
   - Update status (`processing`, `done`)
   - Soft delete
3. Storage/Graph (`graph.html`)
   - Browse `done` notes
   - Placeholder for relation visualization based on `links`

## Data layer (`db.js`)

- Default config: `useFirestore = false`
- IndexedDBStore:
  - object stores: `notes`, `links`
  - filtering by status/tag/query
  - soft delete handling
- FirestoreStore:
  - optional mode only
  - enabled explicitly with `setConfig({ useFirestore: true })`
- Public API:
  - `initDB`, `saveNote`, `getNotes`, `getNoteById`, `updateNote`, `deleteNote`
  - `saveLink`, `getLinks`, `deleteLink`, `clearDB`
  - `setConfig`, `getConfig`

## PWA alignment

- `manifest.json` now uses relative values (`start_url`, `scope`, icon paths).
- `sw.js` precache list uses relative paths to support Pages subpath deployment.
- `index.html` registers service worker via `./sw.js`.

## Current priorities

- Implement actual note-link graph rendering in `graph.html`
- Improve offline UX messaging and cache update flow
- Keep optional Firestore mode documented without changing serverless default behavior
