# Memoirage Context Snapshot (2026-03-30)

## Canonical context

- This file (`CONTEXT.md`) is the canonical execution context for the current app.
- `CONTEXT.orig.md` is preserved as an archive of the initial server/API-oriented design.
- If there is a conflict between the two, this file wins for implementation decisions.

## Architecture decisions (fixed for now)

- Runtime: serverless static app (no dedicated backend server)
- App model: SPA with History API routing
- Data model: offline-first
  - default store: IndexedDB
  - optional extension: Firestore adapter in `db.js`
- Deploy target: static hosting (including GitHub Pages)

## Decision record: why this shape

Initial design assumed Node/Express + SQLite + REST endpoints.
Current product direction intentionally moved to a static SPA to reduce operational complexity and keep local-first behavior as the default.

This means:
- REST endpoints are treated as a historical design artifact, not the current runtime contract.
- The runtime contract is the client data API exported by `db.js`.
- Firestore remains optional and must not become mandatory for core usage.

## Product structure (3-layer intent retained)

- `capture` layer: frictionless input, minimal judgment
- `processing` layer: review/refine/relate notes
- `storage` layer: curated done notes + relationship exploration

Current routes:
- `/`
- `/capture`
- `/processing`
- `/storage`

## Runtime model

Core files:
- `index.html`: SPA entry
- `app.js`: routing + feature UI logic
- `app.css`: shared styles
- `db.js`: storage abstraction (`IndexedDBStore`, optional `FirestoreStore`)
- `sw.js`: service worker cache/offline behavior

Routing/hosting behavior:
- `404.html` recovers static-host deep links via `?route=`
- route entry pages (`capture/`, `processing/`, `storage/`) redirect into SPA shell
- base path normalization supports root + subpath deployments

## Domain model (current)

Primary entities in production:
- `notes`
- `links` (`derive`, `contradict`, `support`, `related`)
- `evolutions` (`extends`, `shrinks`, `decay`)

Status lifecycle:
- `inbox` -> `processing` -> `done`
- soft delete: `deleted` with `deleted_at`

Current IndexedDB details:
- schema version: `2`
- migration `v1 -> v2`: legacy link type normalization

## Scope boundaries

In-scope now:
- robust capture/processing/storage flow
- relationship editing (links + evolutions)
- graph readability and usability
- PWA stability and update UX

Out-of-scope for now (deferred):
- backend REST server resurrection
- mandatory cloud sync

## Roadmap by priority

P1 (stabilize current core):
- improve graph readability for larger datasets
- add app update notification UX for new service worker cache versions
- keep Firestore mode optional and documented

P2 (light model expansion):
- strengthen tag/search workflow (still local-first)
- tighten filtering and retrieval ergonomics in `db.js` and UI

P3 (advanced structure):
- attachments model
- cluster/membership model (hidden by default, progressive exposure)

P4 (assistive intelligence):
- AI refine/merge as optional capability, not a hard dependency
- keep graceful fallback when model/API is unavailable

## Action checklist

Now:
- [x] Improve storage graph readability for larger datasets (layout, overlap, label legibility)
- [x] Add service worker update notification UX (new cache available -> prompt to refresh)
- [x] Document Firestore optional mode more clearly (setup + limits + when to use)

Next:
- [x] Strengthen tag/search workflow in UI (fast filter + consistent query behavior)
- [x] Refine data retrieval ergonomics in `db.js` for common filter patterns

Later:
- [x] Add attachments model incrementally without breaking offline-first flow
- [x] Introduce cluster/membership model behind a hidden/advanced UI gate
- [x] Add optional AI refine/merge path with graceful fallback and no hard dependency

## Working rule for new features

Any new feature should satisfy all three:
- works offline in IndexedDB-first mode
- does not require backend infrastructure
- can be expressed through current SPA + `db.js` contracts
