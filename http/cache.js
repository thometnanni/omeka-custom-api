import { createHash } from "crypto";
import { LRU } from "../utils/lru.js";
import { onSwap } from "../store/sync.js";
import { RESPONSE_CACHE_MB } from "../env.js";

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

// serialized responses of the current snapshot, keyed by route and canonical params
const responses = new LRU(RESPONSE_CACHE_MB * 1024 * 1024, (body) => body.length);
onSwap(() => responses.clear());

/**
 * Canonical cache key for a validated request: path plus sorted params, with
 * comma-separated lists sorted and deduplicated.
 * @param {string} path
 * @param {Object} query
 * @returns {string}
 */
export function cacheKey(path, query = {}) {
  const params = Object.keys(query)
    .sort()
    .map((key) => {
      const value = String(query[key]);
      const canonical = value.includes(",")
        ? [...new Set(value.split(","))].sort().join(",")
        : value;
      return `${key}=${canonical}`;
    });
  return `${path}?${params.join("&")}`;
}

/**
 * Send a JSON response from the response cache, computing it on a miss.
 * Responses carry an ETag derived from the snapshot generation and the key.
 * @param {import("fastify").FastifyRequest} req
 * @param {import("fastify").FastifyReply} reply
 * @param {Object} snapshot
 * @param {string} key - see cacheKey
 * @param {() => *} compute - returns the response body
 */
export function sendCached(req, reply, snapshot, key, compute) {
  let body = responses.get(key);
  if (body === undefined) {
    body = responses.set(key, JSON.stringify(compute()));
  }

  const etag = `"${snapshot.generation}-${hash(key)}"`;
  reply.header("Cache-Control", CACHE_CONTROL).header("ETag", etag);
  if (req.headers["if-none-match"] === etag) return reply.code(304).send();

  return reply.type("application/json; charset=utf-8").send(body);
}

/**
 * Send an uncached JSON response with the default Cache-Control header.
 */
export function sendJson(reply, body) {
  return reply
    .header("Cache-Control", CACHE_CONTROL)
    .type("application/json; charset=utf-8")
    .send(JSON.stringify(body));
}

function hash(str) {
  return createHash("sha1").update(str).digest("base64url").slice(0, 10);
}
