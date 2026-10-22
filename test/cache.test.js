import { test } from "node:test";
import assert from "node:assert/strict";
import { LRU } from "../utils/lru.js";
import { cacheKey } from "../http/cache.js";

test("LRU evicts least recently used entries by size", () => {
  const lru = new LRU(10, (value) => value.length);
  lru.set("a", "aaaa");
  lru.set("b", "bbbb");
  lru.get("a");
  lru.set("c", "cccc");
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), "aaaa");
  assert.equal(lru.size, 8);
  lru.set("huge", "x".repeat(11));
  assert.equal(lru.get("huge"), undefined);
});

test("cache keys are canonical", () => {
  assert.equal(
    cacheKey("/query/", { theme: "2,1,2", lang: "en" }),
    cacheKey("/query/", { lang: "en", theme: "1,2" }),
  );
  assert.notEqual(cacheKey("/query/", { page: 1 }), cacheKey("/query/", { page: 2 }));
});
