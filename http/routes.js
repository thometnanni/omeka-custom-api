import { createReadStream, existsSync } from "fs";
import { localizeObject } from "../utils/helper.js";
import { normalizeLang } from "../utils/languages.js";
import { queryItems } from "../query/items.js";
import { parseSearch } from "../query/search.js";
import { getItemDetails } from "../store/media.js";
import { omekaRequestCount } from "../omeka/client.js";
import { fullSync, getSnapshot, onSwap } from "../store/sync.js";
import { cacheKey, sendCached, sendJson } from "./cache.js";
import {
  EXPORT_PATH,
  FLUSH_SECRET,
  NEWSLETTER_TYPE_ID,
  PAGE_MAX_LIMIT,
} from "../env.js";

// ---
// SCHEMAS
// unknown params are removed, so they neither reach the cache key nor the query
// ---

const lang = { type: "string", maxLength: 10 };
const idList = { type: "string", pattern: "^([0-9]+(,[0-9]+)*)?$", maxLength: 200 };

const langOnly = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: { lang },
  },
};

const itemParams = {
  ...langOnly,
  params: {
    type: "object",
    properties: { id: { type: "integer", minimum: 1 } },
  },
};

const queryParams = {
  params: {
    type: "object",
    properties: { id: { type: "integer", minimum: 1 } },
  },
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      lang,
      objectType: idList,
      creator: idList,
      theme: idList,
      era: idList,
      year: { type: "string", pattern: "^([0-9]{1,4}(,[0-9]{1,4})*)?$", maxLength: 100 },
      search: { type: "string", maxLength: 200 },
      view: { type: "string", enum: ["object", "creator"] },
      page: { type: "integer", minimum: 1, maximum: 10000 },
      limit: { type: "integer", minimum: 1, maximum: PAGE_MAX_LIMIT },
    },
  },
};

// ---
// ROUTES
// ---

/**
 * @param {import("fastify").FastifyInstance} server
 */
export function routes(server) {
  // canonical lang and search, so variants share cache entries
  server.addHook("preHandler", async (req) => {
    if (req.query?.lang != null) req.query.lang = normalizeLang(req.query.lang);
    if (req.query?.search != null) {
      const terms = parseSearch(req.query.search);
      if (terms.length > 0) req.query.search = terms.join(",");
      else delete req.query.search;
    }
  });

  server.get("/filters", { schema: langOnly }, (req, reply) => {
    const snapshot = getSnapshot();
    return sendCached(req, reply, snapshot, cacheKey("/filters", req.query), () =>
      localizeObject(snapshot.filters, req.query.lang),
    );
  });

  server.get("/featured", { schema: langOnly }, (req, reply) => {
    const { featured, ...rest } = featuredPieces(req.query.lang);
    return sendJson(reply, {
      featured: shuffle(featured).slice(0, 12),
      ...rest,
    });
  });

  server.get("/item/:id", { schema: itemParams }, (req, reply) => {
    const snapshot = getSnapshot();
    const record = snapshot.records.get(req.params.id);
    if (record == null) return notFound(reply);
    const key = cacheKey(`/item/${req.params.id}`, req.query);
    return sendCached(req, reply, snapshot, key, () =>
      withConvertedFrom(
        localizeObject(snapshot.fullItem(req.params.id), req.query.lang),
        record.convertedFrom,
        req.query.lang,
      ),
    );
  });

  server.get("/item-details/:id", { schema: itemParams }, async (req, reply) => {
    const record = getSnapshot().records.get(req.params.id);
    if (record == null) return notFound(reply);
    const { convertedFrom, ...details } = await getItemDetails(record);
    return sendJson(
      reply,
      withConvertedFrom(
        localizeObject(details, req.query.lang),
        convertedFrom,
        req.query.lang,
      ),
    );
  });

  const query = (req, reply) => {
    const snapshot = getSnapshot();
    const key = cacheKey(`/query/${req.params.id ?? ""}`, req.query);
    return sendCached(req, reply, snapshot, key, () => {
      const result = queryItems(snapshot, { ...req.query, id: req.params.id });
      return localizeObject(result ?? {}, req.query.lang);
    });
  };
  server.get("/query/", { schema: queryParams }, query);
  server.get("/query/:id", { schema: queryParams }, query);

  server.get("/page/:slug", { schema: langOnly }, (req, reply) => {
    const snapshot = getSnapshot();
    const slug = `${req.params.slug}-${normalizeLang(req.query.lang)}`;
    const page = snapshot.pages.get(slug);
    if (page == null) return notFound(reply, "Page not found");
    return sendCached(req, reply, snapshot, `/page/${slug}`, () => page);
  });

  server.get("/ids", (req, reply) => {
    const snapshot = getSnapshot();
    return sendCached(req, reply, snapshot, "/ids", () => snapshot.ids);
  });

  server.get("/export", (req, reply) => {
    if (!existsSync(EXPORT_PATH)) {
      return reply.status(503).send({ error: "Export not yet available" });
    }
    return reply
      .header("Content-Disposition", 'attachment; filename="export.json"')
      .type("application/json")
      .send(createReadStream(EXPORT_PATH));
  });

  server.get("/status", (req, reply) => {
    const { generation, builtAt, size, pages } = getSnapshot();
    return reply
      .header("Cache-Control", "no-store")
      .send({
        generation,
        builtAt,
        items: size,
        pages: pages.size,
        omekaRequests: omekaRequestCount(),
        heapMB: Math.round(process.memoryUsage().heapUsed / 1e6),
      });
  });

  server.all("/flush", async (req, reply) => {
    if (!FLUSH_SECRET || req.headers["x-flush-secret"] !== FLUSH_SECRET) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    await fullSync();
    return { status: "Synced", generation: getSnapshot().generation };
  });
}

// ---
// FEATURED
// ---

// computed once per snapshot and language; only the featured order changes per request
let featuredCache = new Map();
onSwap(() => (featuredCache = new Map()));

function featuredPieces(lang) {
  const key = lang ?? ""; // normalized by the preHandler hook
  if (!featuredCache.has(key)) {
    const snapshot = getSnapshot();
    featuredCache.set(
      key,
      localizeObject(
        {
          featured: snapshot.featured,
          newItems: queryItems(snapshot, { limit: 11 }).items,
          newsletters: queryItems(snapshot, {
            objectType: String(NEWSLETTER_TYPE_ID),
            limit: 20,
          }).items,
          heroes: snapshot.heroes,
        },
        lang,
      ),
    );
  }
  return featuredCache.get(key);
}

function shuffle(array) {
  return array
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

/**
 * Add the language the text was converted from, if it was converted for lang.
 * @param {Object} body - localized response
 * @param {Object.<string, string>} convertedFrom - e.g. { "zh-hk": "zh" }
 * @param {string} [lang]
 */
function withConvertedFrom(body, convertedFrom, lang) {
  const source = lang && convertedFrom[lang];
  return source ? { ...body, convertedFrom: source } : body;
}

function notFound(reply, error = "Not found") {
  return reply.status(404).send({ error });
}
