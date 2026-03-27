# Memoirage

Memoirage is an offline-first PWA for quickly capturing and organizing personal notes.
It runs as a static web app with IndexedDB as the default storage, so no runtime backend server is required.

## Current Product Direction

- Serverless runtime: static hosting friendly.
- Offline-first default: IndexedDB store.
- Optional Firestore mode is available, but disabled by default.
- GitHub Pages compatibility is a first-class target.

## Repository Layout

```text
memoirage/
|- CONTEXT.md
|- README.md
|- db.js
|- index.html
|- capture.html
|- processing.html
|- graph.html
|- manifest.json
|- sw.js
|- icon-192.png
`- icon-512.png
```

All app routes and assets use relative paths (`./...`) so the app works from both local static servers and GitHub Pages project paths.

## Local Run

1. Start a static server at repo root:

```bash
python -m http.server 8000
```

2. Open pages:
- `http://localhost:8000/index.html`
- `http://localhost:8000/capture.html`
- `http://localhost:8000/processing.html`
- `http://localhost:8000/graph.html`

Notes:
- Use `http://` or `https://`, not `file://`.
- Service Worker and installability are limited on `file://`.

## Data Layer (`db.js`)

Default: `IndexedDBStore`
- object stores: `notes`, `links`
- status/tag/query filtering
- soft delete

Optional: `FirestoreStore`
- enable with `setConfig({ useFirestore: true })`
- requires Firebase SDK loaded by the host page

Public API:
- `initDB`, `saveNote`, `getNotes`, `getNoteById`, `updateNote`, `deleteNote`
- `saveLink`, `getLinks`, `deleteLink`, `clearDB`
- `setConfig`, `getConfig`

## PWA and Offline

- `manifest.json` and `sw.js` are configured with relative paths.
- Home page registers Service Worker from `./sw.js`.
- Storage graph page now renders with inline SVG (no external CDN dependency).

## Deploy to GitHub Pages

1. Push repository to GitHub.
2. Go to `Settings -> Pages`.
3. Set source to `Deploy from a branch` and choose `main` / `root`.
4. Open published URL:
- `https://<username>.github.io/<repo-name>/`

## Next Improvements

- Better graph layout and edge filtering controls.
- Firestore setup guide with auth examples.
- Cache update UX (new version available prompt).
