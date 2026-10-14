import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import { omekaGet, omekaGetAll } from "../omeka/client.js";
import { buildSnapshot } from "./snapshot.js";
import {
  EXPORT_PATH,
  FULL_SYNC_INTERVAL,
  OMEKA_SITE,
  SYNC_INTERVAL,
} from "../env.js";

const PER_PAGE = 50;
const PAGES_PATH = EXPORT_PATH.replace(/(\.json)?$/, ".pages.json");

let snapshot = null;
let rawItems = new Map();
let rawPages = [];
const listeners = [];

/**
 * The current snapshot. Never mutated; replaced on every change.
 * @returns {Object|null} null until the first snapshot is built
 */
export function getSnapshot() {
  return snapshot;
}

/**
 * Register a callback that runs after every snapshot swap.
 * @param {(snapshot: Object) => void} listener
 */
export function onSwap(listener) {
  listeners.push(listener);
}

function swap() {
  const start = performance.now();
  snapshot = buildSnapshot([...rawItems.values()], rawPages);
  console.log(
    `Snapshot ${snapshot.generation}: ${snapshot.size} items, ${snapshot.pages.size} pages (${Math.round(performance.now() - start)} ms)`,
  );
  listeners.forEach((listener) => listener(snapshot));
}

// ---
// EXCLUSIVE EXECUTION
// ---

let queue = Promise.resolve();
let pendingFullSync = null;

function exclusive(task) {
  const run = queue.then(task);
  queue = run.catch((err) => console.error("Sync failed:", err));
  return run;
}

/**
 * Fetch all items and pages and replace the snapshot. Concurrent calls
 * while a full sync is waiting to run share that sync.
 * @returns {Promise<void>}
 */
export function fullSync() {
  pendingFullSync ??= exclusive(async () => {
    pendingFullSync = null;
    await runFullSync();
  });
  return pendingFullSync;
}

/**
 * Fetch items modified since the last sync and update the snapshot.
 * Falls back to a full sync when items were deleted or unpublished.
 * Site pages are only updated by full syncs.
 * @returns {Promise<void>}
 */
export function incrementalSync() {
  return exclusive(runIncrementalSync);
}

async function runFullSync() {
  const items = await omekaGetAll("items");
  const pages = await fetchPages();

  // keep unchanged items as the same objects, so the snapshot build can reuse
  // their prepared data
  rawItems = new Map(
    items.map((item) => {
      const previous = rawItems.get(item["o:id"]);
      const unchanged =
        previous && JSON.stringify(previous) === JSON.stringify(item);
      return [item["o:id"], unchanged ? previous : item];
    }),
  );
  rawPages = pages;
  swap();
  await writeExport();
}

async function runIncrementalSync() {
  const watermark = [...rawItems.values()].reduce(
    (max, item) => (modified(item) > max ? modified(item) : max),
    "",
  );

  const changed = [];
  let total = null;

  for (let page = 1; ; page++) {
    const { data, total: pageTotal } = await omekaGet(
      `/items?sort_by=modified&sort_order=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    total ??= pageTotal;

    const newer = data.filter((item) => modified(item) >= watermark);
    changed.push(
      ...newer.filter(
        (item) => modified(rawItems.get(item["o:id"])) !== modified(item),
      ),
    );
    if (newer.length < data.length || data.length < PER_PAGE) break;
  }

  if (total != null && total !== rawItems.size + newItems(changed)) {
    console.log(
      `Sync: Omeka has ${total} items, snapshot ${rawItems.size}. Running full sync`,
    );
    await runFullSync();
    return;
  }

  if (changed.length === 0) return;

  changed.forEach((item) => rawItems.set(item["o:id"], item));
  console.log(`Sync: ${changed.length} changed items`);
  swap();
  await writeExport();
}

/**
 * Site pages, reduced to what /page serves: some pages embed images as
 * base64 and weigh megabytes, so they are only fetched on full syncs.
 * @returns {Promise<Object[]>}
 */
async function fetchPages() {
  const pages = await omekaGetAll("site_pages", { site: OMEKA_SITE });
  return pages.map((page) => ({
    "o:id": page["o:id"],
    "o:slug": page["o:slug"],
    "o:title": page["o:title"],
    "o:block": (page["o:block"] ?? [])
      .filter((block) => block["o:layout"] === "html")
      .slice(0, 1),
  }));
}

function newItems(items) {
  return items.filter((item) => !rawItems.has(item["o:id"])).length;
}

function modified(item) {
  return item?.["o:modified"]?.["@value"] ?? "";
}

// ---
// EXPORT FILE
// ---

/**
 * Build the first snapshot from the export files, if there are any.
 * @returns {Promise<boolean>} whether a snapshot was loaded
 */
export async function loadExport() {
  if (!existsSync(EXPORT_PATH)) return false;
  try {
    const items = JSON.parse(await readFile(EXPORT_PATH, "utf8"));
    rawItems = new Map(items.map((item) => [item["o:id"], item]));
    if (existsSync(PAGES_PATH)) {
      rawPages = JSON.parse(await readFile(PAGES_PATH, "utf8"));
    }
    swap();
    return true;
  } catch (err) {
    console.error("Failed to load export file:", err);
    return false;
  }
}

async function writeExport() {
  try {
    await writeAtomic(EXPORT_PATH, JSON.stringify([...rawItems.values()]));
    await writeAtomic(PAGES_PATH, JSON.stringify(rawPages));
  } catch (err) {
    console.error("Failed to write export file:", err);
  }
}

// write to a temporary file first, so readers never see a partial file
async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
}

// ---
// SCHEDULE
// ---

/**
 * Run incremental syncs every SYNC_INTERVAL and full syncs every
 * FULL_SYNC_INTERVAL seconds.
 */
export function scheduleSync() {
  const loop = (sync, seconds) => {
    setTimeout(async () => {
      await sync().catch(() => {});
      loop(sync, seconds);
    }, seconds * 1000);
  };
  loop(incrementalSync, SYNC_INTERVAL);
  loop(fullSync, FULL_SYNC_INTERVAL);
}
