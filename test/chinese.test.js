import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../store/snapshot.js";
import { queryItems } from "../query/items.js";
import { convertTo, foldScript } from "../utils/chinese.js";
import { localizeObject } from "../utils/helper.js";
import { normalizeHtml, normalizeValue } from "../utils/normalize.js";
import { COLLATORS } from "../utils/languages.js";
import { rawItem } from "./fixture.js";

const items = [
  // simplified only
  rawItem({
    id: 1,
    title: { en: "Hair", zh: "头发" },
    description: { zh: "关于头发的书" },
    text: "后来他们在香港讨论软件。",
    created: 1,
  }),
  // traditional only
  rawItem({ id: 2, title: { en: "Software", "zh-hk": "軟件與後來" }, created: 2 }),
  // both scripts authored
  rawItem({ id: 3, title: { en: "Global China", zh: "全球中国", "zh-hk": "全球中國" }, created: 3 }),
  // Chinese tags with latin text only
  rawItem({ id: 4, title: { en: "Latin", zh: "Latin" }, created: 4 }),
];
const pages = [
  { "o:id": 1, "o:slug": "about-zh", "o:title": "关于我们", "o:block": [{ "o:layout": "html", "o:data": { html: "<p>头发</p>" } }] },
  { "o:id": 2, "o:slug": "about-en", "o:title": "About", "o:block": [] },
  { "o:id": 3, "o:slug": "news-zh", "o:title": "新闻", "o:block": [] },
  { "o:id": 4, "o:slug": "news-zh-hk", "o:title": "新聞（香港）", "o:block": [] },
];
const snapshot = buildSnapshot(items, pages);

test("s2hkp and hk2sp convert phrases", () => {
  assert.equal(convertTo("头发 后来 皇后", "zh-hk"), "頭髮 後來 皇后");
  assert.equal(convertTo("軟件 後來", "zh"), "软件 后来");
  assert.equal(convertTo("no han", "zh-hk"), "no han");
  assert.equal(convertTo("头发", "en"), "头发");
});

test("language maps get the missing Chinese script on sync", () => {
  const value = normalizeValue([
    { "@language": "en", "@value": "Hair" },
    { "@language": "zh", "@value": "头发" },
  ]);
  assert.deepEqual(value, { en: "Hair", zh: "头发", "zh-hk": "頭髮" });
  assert.deepEqual(normalizeValue([{ "@language": "zh-hk", "@value": "頭髮" }]), {
    "zh-hk": "頭髮",
    zh: "头发",
  });
  // untagged values stay plain
  assert.equal(normalizeValue([{ "@value": "头发" }]), "头发");
  assert.equal(normalizeValue([{ "@value": "2019" }, { "@value": "2020" }]), "2019");
  // next to tagged values, untagged ones count as zh or en by script
  assert.deepEqual(
    normalizeValue([{ "@language": "zh", "@value": "头发" }, { "@value": "Hair" }]),
    { zh: "头发", en: "Hair", "zh-hk": "頭髮" },
  );
  assert.deepEqual(
    normalizeValue([{ "@language": "en", "@value": "Hair" }, { "@value": "头发" }]),
    { en: "Hair", zh: "头发", "zh-hk": "頭髮" },
  );
  assert.deepEqual(normalizeValue([{ "@value": "x" }, { "@language": "en", "@value": "y" }]), { en: "y" });
});

test("authored values are never converted", () => {
  const title = snapshot.records.get(3).title;
  assert.equal(localizeObject(title, "zh-hk"), "全球中國");
  assert.equal(localizeObject(title, "zh-cn"), "全球中国");
  assert.equal(localizeObject(title, "en"), "Global China");
});

test("localization picks converted values and converts untagged strings", () => {
  const item = localizeObject(snapshot.fullItem(1), "zh-hk");
  assert.equal(item.title, "頭髮");
  assert.equal(item.description, "關於頭髮的書");
  assert.equal(localizeObject(snapshot.fullItem(2), "zh-cn").title, "软件与后来");
  assert.equal(localizeObject({ snippet: "后来" }, "zh-hk").snippet, "後來");
  assert.equal(localizeObject({ snippet: "后来" }, "en").snippet, "后来");
});

test("convertedFrom marks converted titles and descriptions", () => {
  assert.deepEqual(snapshot.records.get(1).convertedFrom, { "zh-hk": "zh" });
  assert.deepEqual(snapshot.records.get(2).convertedFrom, { zh: "zh-hk" });
  assert.deepEqual(snapshot.records.get(3).convertedFrom, {});
  // nothing to convert without Chinese characters
  assert.deepEqual(snapshot.records.get(4).convertedFrom, {});
});

test("html media are converted and marked", () => {
  const { html, convertedFrom } = normalizeHtml([
    { "o:renderer": "html", "o:lang": "zh", data: { html: "&lt;p&gt;头发&lt;/p&gt;" } },
    { "o:renderer": "file" },
  ]);
  assert.deepEqual(html, { zh: "<p>头发</p>", "zh-hk": "<p>頭髮</p>" });
  assert.deepEqual(convertedFrom, { "zh-hk": "zh" });
});

test("pages missing a Chinese script are generated", () => {
  assert.deepEqual(snapshot.pages.get("about-zh-hk"), {
    title: "關於我們",
    html: "<p>頭髮</p>",
    convertedFrom: "zh",
  });
  assert.equal(snapshot.pages.get("about-zh").convertedFrom, undefined);
  // authored pages win
  assert.equal(snapshot.pages.get("news-zh-hk").title, "新聞（香港）");
  assert.equal(snapshot.pages.has("about-en-zh-hk"), false);
});

test("search matches across scripts", () => {
  assert.equal(foldScript("頭髮軟件後來"), "头发软件后来");
  assert.equal(foldScript("頭髮").length, 2);

  const ids = (search) => queryItems(snapshot, { search }).items.map(({ id }) => id);
  assert.deepEqual(ids("頭髮"), [1]);
  assert.deepEqual(ids("软件"), [2, 1]);

  // snippets quote the original text, localization converts them
  const [result] = queryItems(snapshot, { search: "後來" }).items.filter(({ id }) => id === 1);
  assert.equal(result.snippets[0].term, "后来");
  assert.equal(localizeObject(result, "zh-hk").snippets[0].term, "後來");
});

test("snippets of tagged texts are kept for their own language", () => {
  const [result] = queryItems(snapshot, { search: "头发的书" }).items;
  assert.deepEqual(result.snippets[0].term, { zh: "头发的书" });
  assert.equal(localizeObject(result, "zh-cn").snippets[0].term, "头发的书");
  assert.equal(localizeObject(result, "zh-hk").snippets[0].term, "頭髮的書");
});

test("zh-hk title order uses converted titles", () => {
  const records = [...snapshot.records.values()];
  const byRank = records
    .toSorted((a, b) => a.titleRank["zh-hk"] - b.titleRank["zh-hk"])
    .map(({ id }) => id);
  const byConvertedTitle = records
    .map((record) => ({ id: record.id, title: localizeObject(record.title, "zh-hk") }))
    .sort((a, b) => COLLATORS["zh-hk"].compare(a.title, b.title) || a.id - b.id)
    .map(({ id }) => id);
  assert.deepEqual(byRank, byConvertedTitle);
  assert.equal(localizeObject(snapshot.records.get(1).title, "zh-hk"), "頭髮");
});
