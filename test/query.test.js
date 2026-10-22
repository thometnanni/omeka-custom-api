import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../store/snapshot.js";
import { queryItems } from "../query/items.js";
import { fold, matchQuality, parseSearch, scoreRecord } from "../query/search.js";
import {
  items,
  CREATOR_A,
  CREATOR_B,
  TYPE_BOOK,
  TYPE_NEWSLETTER,
  THEME_LABOR,
  PERIODICAL,
  rawItem,
} from "./fixture.js";

const snapshot = buildSnapshot(items);
const ids = (result) => result.items.map(({ id }) => id);

test("main page: objects without parts, newest first, no facets", () => {
  const result = queryItems(snapshot, { lang: "en" });
  assert.deepEqual(ids(result), [42, 41, 40, PERIODICAL]);
  assert.equal(result.filters, null);
  assert.deepEqual(result.counts, { objects: 4, creators: 3 });
});

test("main page creator view: all creators sorted by title", () => {
  const result = queryItems(snapshot, { lang: "en", view: "creator" });
  assert.deepEqual(ids(result), [CREATOR_A, CREATOR_B, 3]);
  assert.equal(result.total, 3);
});

test("filters are ANDed across and within types", () => {
  assert.deepEqual(ids(queryItems(snapshot, { objectType: String(TYPE_BOOK) })), [41, 40]);
  assert.deepEqual(
    ids(queryItems(snapshot, { objectType: String(TYPE_BOOK), theme: String(THEME_LABOR) })),
    [40],
  );
  assert.deepEqual(ids(queryItems(snapshot, { creator: `${CREATOR_A},${CREATOR_B}` })), [41]);
  assert.deepEqual(ids(queryItems(snapshot, { year: "1989" })), [41, 40]);
  assert.deepEqual(ids(queryItems(snapshot, { objectType: "99999" })), []);
});

test("creators of matching objects are included and counted", () => {
  const result = queryItems(snapshot, { objectType: String(TYPE_NEWSLETTER), view: "creator" });
  assert.deepEqual(ids(result), [CREATOR_B]);
  assert.deepEqual(result.counts, { objects: 2, creators: 1 });
});

test("facets cover the full match set, not the page", () => {
  const result = queryItems(snapshot, { objectType: String(TYPE_BOOK), limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.hasNextPage, true);
  assert.equal(result.total, 2);
  assert.equal(result.filters.objectType[TYPE_BOOK], 2);
  assert.equal(result.filters.year["1989"], 2);
  assert.equal(result.filters.year["1990"], 1);
});

test("pagination", () => {
  const page1 = queryItems(snapshot, { limit: 3 });
  const page2 = queryItems(snapshot, { limit: 3, page: 2 });
  assert.deepEqual(ids(page1), [42, 41, 40]);
  assert.deepEqual(ids(page2), [PERIODICAL]);
  assert.equal(page1.hasNextPage, true);
  assert.equal(page2.hasNextPage, false);
});

test("id scope: linking items sorted by title, parts included, item itself excluded", () => {
  const result = queryItems(snapshot, { id: CREATOR_A, lang: "en" });
  assert.deepEqual(ids(result), [41, 40]);
  assert.deepEqual(ids(queryItems(snapshot, { id: CREATOR_A, view: "creator" })), [CREATOR_B]);
  assert.deepEqual(ids(queryItems(snapshot, { id: PERIODICAL })), [31]);
  assert.equal(queryItems(snapshot, { id: 40 }), null);
});

test("search: AND, ranked by field weight, includes parts and snippets", () => {
  const result = queryItems(snapshot, { search: "hong kong", lang: "en" });
  // title match first, then text matches by date
  assert.deepEqual(ids(result), [40, 41, 31]);
  assert.deepEqual(ids(queryItems(snapshot, { search: "hong kong,apple" })), [41]);

  const [snippet] = result.items.find(({ id }) => id === 41).snippets;
  assert.equal(snippet.term, "hong kong");
});

test("search folds case, diacritics and full width", () => {
  assert.equal(fold("Café ＣＡＦＥ"), "cafe cafe");
  assert.deepEqual(parseSearch('"Café",ab,香'), ["cafe", "香"]);

  const result = queryItems(snapshot, { search: "cafe" });
  assert.deepEqual(ids(result), [41]);
  const [snippet] = result.items[0].snippets;
  // the snippet maps back to the original text, although "…" folds to "..."
  assert.equal(snippet.term, "ＣＡＦＥ");

  const creators = queryItems(snapshot, { search: "café", view: "creator" });
  assert.deepEqual(ids(creators), [CREATOR_B, CREATOR_A]);
  assert.equal(creators.items[0].snippets[0].term, "café");
});

test("score is 0 unless every term matches", () => {
  const record = snapshot.records.get(40);
  assert.equal(scoreRecord(record, ["zebra", "missing"]), 0);
  assert.ok(scoreRecord(record, ["zebra"]) > scoreRecord(record, ["labor"]));
});

test("whole words rank above word starts and substrings", () => {
  const ranking = buildSnapshot([
    rawItem({ id: 1, type: "foaf:Person", title: "Brian Smith", created: 3 }),
    rawItem({ id: 2, type: "foaf:Person", title: "Ianto Jones", created: 2 }),
    rawItem({ id: 3, type: "foaf:Person", title: "Lee, Ian", created: 1 }),
    rawItem({ id: 10, title: "Canadian archives", created: 10 }),
    rawItem({ id: 11, title: "Letters", description: "Written by Ian Lee.", created: 9 }),
    rawItem({
      id: 12,
      title: "Diaries",
      text: "Brian wrote to his friend Ian.",
      created: 8,
    }),
  ]);
  const ids = (query) => queryItems(ranking, query).items.map(({ id }) => id);

  assert.deepEqual(ids({ search: "ian", view: "creator" }), [3, 2, 1]);
  // a description word match (2 × 1) beats a title substring match (5 × 0.2)
  assert.deepEqual(ids({ search: "ian" }), [11, 10, 12]);
  // still every term has to match
  assert.deepEqual(ids({ search: "ian,letters" }), [11]);

  // snippets prefer the whole word
  const diaries = queryItems(ranking, { search: "ian" }).items.find(({ id }) => id === 12);
  assert.equal(diaries.snippets[0].term, "Ian");
  assert.equal(diaries.snippets[1].term, "ian");
});

test("match quality: word, prefix, substring, Chinese", () => {
  assert.equal(matchQuality("lee, ian", "ian"), 1);
  assert.equal(matchQuality("ianto jones", "ian"), 0.5);
  assert.equal(matchQuality("brian smith", "ian"), 0.2);
  assert.equal(matchQuality("brian and ian", "ian"), 1);
  assert.equal(matchQuality("hong kong", "ian"), 0);
  assert.equal(matchQuality("visit hong kong!", "hong kong"), 1);
  // no spaces in Chinese: every occurrence counts as a word
  assert.equal(matchQuality("我在香港工作", "香港"), 1);
});
