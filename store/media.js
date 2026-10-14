import { omekaGet } from "../omeka/client.js";
import { normalizeHtml, normalizeMedia } from "../utils/normalize.js";
import { LRU } from "../utils/lru.js";
import { MEDIA_CACHE_MB } from "../env.js";

// media are not part of the item payload and are fetched on demand
const cache = new LRU(
  MEDIA_CACHE_MB * 1024 * 1024,
  (details) => JSON.stringify(details).length,
);
const inflight = new Map();

/**
 * Media and html blocks of an item. Only called for items in the snapshot, so
 * unknown ids never reach Omeka. Cached by id and modification date, so
 * editing an item invalidates its entry.
 * @param {{id:number, modified:string, item:{media?:number[]}}} record
 * @returns {Promise<{media:Object[]|null, html:*, convertedFrom:Object.<string, string>}>}
 *   convertedFrom: languages of the html converted from the other Chinese script
 */
export async function getItemDetails(record) {
  const ids = record.item.media ?? [];
  if (ids.length === 0) return { media: null, html: null, convertedFrom: {} };

  const key = `${record.id}:${record.modified}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (!inflight.has(key)) {
    const request = omekaGet(`/media?id=${ids.join(",")}&per_page=${ids.length}`)
      .then(({ data }) =>
        cache.set(key, { media: normalizeMedia(data), ...normalizeHtml(data) }),
      )
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
  }
  return inflight.get(key);
}
