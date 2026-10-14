import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../store/snapshot.js";
import {
  items,
  rawItem,
  CREATOR_A,
  CREATOR_B,
  CREATOR_UNUSED,
  TYPE_BOOK,
  THEME_LABOR,
  PERIODICAL,
} from "./fixture.js";

const snapshot = buildSnapshot(items, [
  { "o:id": 1, "o:slug": "about-en", "o:title": "About", "o:block": [{ "o:layout": "html", "o:data": { html: "&lt;p&gt;Hi&lt;/p&gt;" } }] },
  { "o:id": 2, "o:slug": "about-en", "o:title": "Duplicate" },
]);

test("counts exclude parts", () => {
  assert.deepEqual(snapshot.counts, { creators: 3, objects: 4 });
});

test("global filters count items that are not parts", () => {
  const { creator, objectType, theme, year } = snapshot.filters;
  assert.deepEqual(
    creator.map(({ id, count }) => [id, count]),
    [
      [CREATOR_A, 2],
      [CREATOR_B, 2],
    ],
  );
  assert.equal(creator.find(({ id }) => id === CREATOR_UNUSED), undefined);
  assert.deepEqual(objectType.find(({ id }) => id === TYPE_BOOK), { id: TYPE_BOOK, title: "Book", count: 2 });
  assert.deepEqual(theme, [{ id: THEME_LABOR, title: "Labor", count: 2 }]);
  // every distinct year of an item counts, ties sorted by year
  assert.deepEqual(year, [
    { value: "1989", count: 2 },
    { value: "1990", count: 2 },
  ]);
});

test("reverse index matches linking items", () => {
  assert.deepEqual([...snapshot.reverse.get(CREATOR_A)].sort(), [40, 41]);
  assert.deepEqual([...snapshot.reverse.get(PERIODICAL)], [31]);
  assert.deepEqual(snapshot.fullItem(CREATOR_A).items, [40, 41]);
  assert.equal(snapshot.fullItem(40).items, undefined);
});

test("linked properties are resolved with current titles", () => {
  const { item } = snapshot.records.get(41);
  assert.deepEqual(item.creator, [
    { id: CREATOR_A, title: { en: "Alice Zhang", zh: "张爱丽" } },
    { id: CREATOR_B, title: "Bob Wang" },
  ]);

  const renamed = items.map((raw) =>
    raw["o:id"] === CREATOR_B ? rawItem({ id: CREATOR_B, type: "foaf:Person", title: "Robert Wang" }) : raw,
  );
  const next = buildSnapshot(renamed);
  assert.equal(next.records.get(41).item.creator[1].title, "Robert Wang");
  assert.ok(next.records.get(41).search.linked.includes("robert wang"));
});

test("featured, heroes, ids and pages", () => {
  assert.deepEqual(snapshot.featured.map(({ id }) => id), [40, 41]);
  assert.deepEqual(snapshot.heroes, ["https://files/41-l.jpg"]);
  assert.equal(snapshot.ids[41], "2025-01-01");
  assert.deepEqual(snapshot.pages.get("about-en"), { title: "About", html: "<p>Hi</p>" });
});

test("default order is created desc, title ranks per language", () => {
  assert.deepEqual(snapshot.byCreated.slice(0, 3).map(({ id }) => id), [42, 41, 40]);
  const apple = snapshot.records.get(41);
  const zebra = snapshot.records.get(40);
  assert.ok(apple.titleRank.en < zebra.titleRank.en);
});

test("snapshots get distinct generations", () => {
  assert.notEqual(buildSnapshot(items).generation, buildSnapshot(items).generation);
});
