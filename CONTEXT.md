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
- hidden advanced mode toggle: `Alt+Shift+A` (persisted in localStorage)
- optional host AI hook: `window.memoirageAI.refine(content)` with local fallback when unavailable

## Domain model (current)

Primary entities in production:
- `notes`
- `links` (`derive`, `contradict`, `support`, `related`)
- `evolutions` (`extends`, `shrinks`, `decay`)

Status lifecycle:
- `inbox` -> `processing` -> `done`
- soft delete: `deleted` with `deleted_at`

Incremental note extensions now in use:
- `tags` (auto-extracted from `#hashtag` in content and used for list filtering)
- `attachments` (optional URL list stored in note payload)
- `cluster_id` (optional advanced grouping field; hidden UI by default)

Current IndexedDB details:
- schema version: `2`
- migration `v1 -> v2`: legacy link type normalization

## Scope boundaries

In-scope now:
- robust capture/processing/storage flow
- relationship editing (links + evolutions)
- graph readability and usability
- PWA stability and update UX
- fast query/filter UX in processing/storage lists (`text`, `#tag`, `status:`)
- incremental attachment + cluster support without backend dependency
- optional AI refine path with graceful local fallback

Out-of-scope for now (deferred):
- backend REST server resurrection
- mandatory cloud sync

## Roadmap by priority

P1 (stabilize current core):
- stabilize new query/filter flows with real-world datasets
- validate attachment/cluster behavior in mobile layouts
- keep Firestore mode optional and documented

P2 (light model expansion):
- improve tag lifecycle UX (manual edit/remove, normalization, discoverability)
- tighten retrieval ergonomics around attachments/clusters in `db.js`

P3 (advanced structure):
- richer attachment model (type metadata, previews, safer URL handling)
- cluster/membership evolution (progressive exposure from hidden mode)

P4 (assistive intelligence):
- richer optional AI refine/merge workflows
- keep graceful fallback when model/API is unavailable

## Action checklist

Now:
- [x] Add tag edit/removal controls in note detail (not only auto-extraction)
- [x] Add small onboarding hint for query syntax (`#tag`, `status:`) in list UIs
- [x] Add basic validation/limits UI for attachment URL + label input

Next:
- [ ] Add `attachments_count` / `cluster_id`-aware helper retrieval patterns in `db.js`
- [ ] Add advanced-mode discoverability hint without exposing by default

Later:
- [ ] Introduce richer attachment metadata (kind, source, optional preview text)
- [ ] Expand optional AI flow from refine-only to refine+merge suggestions

## Working rule for new features

Any new feature should satisfy all three:
- works offline in IndexedDB-first mode
- does not require backend infrastructure
- can be expressed through current SPA + `db.js` contracts
