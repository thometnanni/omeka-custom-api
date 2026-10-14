# OMEKA CUSTOM API

A read-only API in front of an Omeka S instance. It keeps a snapshot of all public items and site pages in memory and answers every request from it. Omeka is only contacted by the background sync (and for item media, see below), so traffic to this API never reaches Omeka.

## How it works

- **Snapshot** (`store/snapshot.js`): all raw items are normalized once and indexed (by id, by linked creator/type/theme/era, by year, reverse links, title order per language). Global filters, counts, featured items and heroes are precomputed. A snapshot is immutable and replaced as a whole on every change.
- **Sync** (`store/sync.js`)
  - every `SYNC_INTERVAL` seconds: fetch items sorted by modification date until reaching already known ones; rebuild the snapshot if something changed.
  - if Omeka reports a different number of items than expected (deleted or unpublished items), every `FULL_SYNC_INTERVAL` seconds, or on `/flush`: fetch all items and site pages. Site pages are only refreshed this way, as some embed megabytes of base64 images.
  - after each change the snapshot is written to `EXPORT_PATH` (served by `/export`) and loaded from there on startup, so a restart serves immediately and catches up in the background.
- **Queries** (`query/`): filtering, search, sorting, facets and pagination run on the snapshot. Search folds case, diacritics and full-width characters and ranks title matches above description and text matches.
- **HTTP** (`http/`): query strings are validated (unknown params are dropped, invalid ones get a 400). Serialized responses are kept in an LRU cache that is cleared on every snapshot change, and sent with `Cache-Control` and `ETag` headers.
- **Chinese scripts** (`utils/chinese.js`): when a value exists only in `zh` (simplified) or `zh-hk` (traditional), the other script is generated with OpenCC (s2hkp / hk2sp). This happens when the snapshot is built, so requests only pick the stored value. Untagged text and search snippets are converted per request for `zh` / `zh-hk`. `/item` and `/item-details` report converted text with `convertedFrom`. Search folds traditional to simplified characters, so both scripts match.
- **Media** (`store/media.js`): `/item-details` fetches media from Omeka on first request and caches them until the item is modified. Only ids in the snapshot are fetched.

## Routes

| Route | |
|---|---|
| `GET /query/:id?` | items, see `query/items.js` for params |
| `GET /filters` | all filter values with counts |
| `GET /featured` | featured items, newest items, newsletters, heroes |
| `GET /item/:id` | one item |
| `GET /item-details/:id` | media and html of one item |
| `GET /page/:slug` | site page `<slug>-<lang>` |
| `GET /ids` | all item ids with modification date |
| `GET /export` | raw items as JSON |
| `GET /status` | snapshot generation, size, Omeka request count, heap |
| `POST /flush` | run a full sync now, requires `x-flush-secret` header |

All routes accept `?lang=en|zh|zh-hk` to localize multilingual values. API changes are listed in [BREAKING_CHANGES.md](BREAKING_CHANGES.md).

## Setup

create an .env file based on the example

```
cp .env.example .env
```

install dependencies

```
npm i
```

start server

```
node index.js
```

development with hot reload

```
npm run dev
```

## Testing

```
npm test
```

Compare the responses of two running instances, e.g. before and after a change:

```
node scripts/compare.js http://localhost:3200 http://localhost:3100
```

Simulate bot traffic with random queries and check that Omeka gets no requests:

```
node scripts/load.js http://localhost:3100 20 50
```
