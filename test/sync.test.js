import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { items, rawItem } from "./fixture.js";

// fake Omeka: serves `omeka` sorted and paginated like the real API
let omeka = [];
let requests = [];

globalThis.fetch = async (url) => {
  const { pathname, searchParams } = new URL(url);
  requests.push(pathname + "?" + searchParams);
  const perPage = +searchParams.get("per_page");
  const page = +searchParams.get("page");

  let list = pathname.endsWith("/site_pages") ? [] : [...omeka];
  if (searchParams.get("sort_by") === "modified") {
    list.sort((a, b) => b["o:modified"]["@value"].localeCompare(a["o:modified"]["@value"]));
  } else {
    list.sort((a, b) => a["o:id"] - b["o:id"]);
  }

  return new Response(JSON.stringify(list.slice((page - 1) * perPage, page * perPage)), {
    headers: { "omeka-s-total-results": String(list.length) },
  });
};

let sync;
before(async () => {
  process.env.EXPORT_PATH = join(mkdtempSync(join(tmpdir(), "sync-test-")), "export.json");
  sync = await import("../store/sync.js");
});

test("full sync builds a snapshot and writes the export", async () => {
  omeka = [...items];
  await sync.fullSync();
  assert.equal(sync.getSnapshot().size, items.length);
  const exported = JSON.parse(readFileSync(process.env.EXPORT_PATH, "utf8"));
  assert.equal(exported.length, items.length);
});

test("incremental sync without changes keeps the snapshot", async () => {
  const { generation } = sync.getSnapshot();
  requests = [];
  await sync.incrementalSync();
  assert.equal(sync.getSnapshot().generation, generation);
  assert.equal(requests.filter((r) => r.includes("sort_by=modified")).length, 1);
});

test("incremental sync picks up edits", async () => {
  omeka = omeka.map((raw) =>
    raw["o:id"] === 40 ? rawItem({ id: 40, title: "Edited", created: 40, modified: 500 }) : raw,
  );
  await sync.incrementalSync();
  assert.equal(sync.getSnapshot().records.get(40).title, "Edited");
});

test("incremental sync pages through large batches", async () => {
  const added = Array.from({ length: 120 }, (_, i) =>
    rawItem({ id: 1000 + i, title: `New ${i}`, created: 600, modified: 600 + i }),
  );
  omeka = [...omeka, ...added];
  requests = [];
  await sync.incrementalSync();

  assert.equal(sync.getSnapshot().size, items.length + 120);
  // 3 pages of modified items, no full sync
  assert.equal(requests.filter((r) => r.includes("sort_by=modified")).length, 3);
  assert.equal(requests.filter((r) => r.includes("sort_by=id") && r.includes("/items")).length, 0);
});

test("deleted items trigger a full sync", async () => {
  omeka = omeka.filter((raw) => raw["o:id"] !== 41);
  requests = [];
  await sync.incrementalSync();

  assert.equal(sync.getSnapshot().records.has(41), false);
  assert.ok(requests.some((r) => r.includes("/items") && r.includes("sort_by=id")));
});

test("concurrent full syncs are coalesced", async () => {
  requests = [];
  await Promise.all([sync.fullSync(), sync.fullSync(), sync.fullSync()]);
  const fullFetches = requests.filter(
    (r) => r.includes("/items?") && r.includes("sort_by=id") && r.endsWith("&page=1"),
  );
  assert.equal(fullFetches.length, 1);
});
