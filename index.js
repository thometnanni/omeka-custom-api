import { createReadStream, existsSync } from "fs";
import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, localizeObject } from "./utils/helper.js";
import { delCache, flushCache, setCache, ttlCache } from "./redis.js";
import {
  EXPORT_PATH,
  ORIGIN,
  API_PORT,
  API_HOST,
  NEWSLETTER_TYPE_ID,
  FLUSH_SECRET,
} from "./env.js";
import {
  getFilters,
  getFeatured,
  getItem,
  getItemDetails,
  queryItems,
  queryCreators,
  getHeroes,
  getPage,
  getCreators,
  getCounts,
  getLastModified,
  getAllItems,
  getIds,
} from "./api.js";
// ---
// SETUP
// ---

// FASTIFY+CORS
const server = fastify({});
await server.register(cors, {
  origin: parseOrigin(ORIGIN),
});

// ---
// ROUTES
// ---
// FLUSH
server.all("/flush", async (req, reply) => {
  if (!FLUSH_SECRET || req.headers["x-flush-secret"] !== FLUSH_SECRET) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  await flush();
  return { status: "Cache flushed" };
});

// CUSTOM
server.get("/filters", async (req, res) => {
  return localizeObject(await getFilters(), req.query?.lang);
});

server.get("/featured", async (req, reply) => {
  const featured = await getFeatured();
  if (featured.error) return reply.send(featured.error);

  const newItems = await queryItems(
    null,
    { limit: 50 },
    { retrieveCreators: false, ttl: 60 * 11 },
  );
  if (newItems.error) return reply.send(newItems.error);

  const newsletters = await queryItems(
    null,
    {
      limit: 20,
      objectType: NEWSLETTER_TYPE_ID,
    },
    { retrieveCreators: false, ttl: 60 * 13 },
  );
  if (newsletters.error) return reply.send(newsletters.error);

  const heroes = await getHeroes();
  if (heroes.error) return reply.send(heroes.error);

  return localizeObject(
    {
      featured: featured
        .map((value) => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value)
        .slice(0, 12),
      newItems: newItems.items.slice(0, 11),
      newsletters: newsletters.items,
      heroes,
    },
    req.query.lang,
  );
});

server.get("/item/:id(^[0-9]+$)", async (req, reply) => {
  const res = await getItem(req.params.id);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, req.query.lang);
});

server.get("/item-details/:id(^[0-9]+$)", async (req, reply) => {
  const res = await getItemDetails(req.params.id);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, req.query.lang);
});

server.get("/query/:id(^[0-9]+$)", async (req, reply) => {
  const isOnMainPage = !Object.keys(req.query).find(
    (key) => !["view", "page", "lang"].includes(key),
  );
  const isOnMainCreatorPage = req.query.view === "creator" && isOnMainPage;

  const res = isOnMainCreatorPage
    ? await queryCreators(req.query)
    : await queryItems(req.params.id, req.query, {
        retrieveCreators: !isOnMainPage,
        removeCreators: isOnMainPage,
      });
  if (res.error) return reply.send(res.error);
  return localizeObject(res, req.query.lang);
});

server.get("/page/:slug", async (req, reply) => {
  const res = await getPage(req.params.slug, req.query.lang);
  if (res.error) return reply.send(res.error);
  return res;
});

server.get("/ids", async (req, reply) => {
  const res = await getIds(req.params.id);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, req.query.lang);
});

server.get("/export", async (req, reply) => {
  if (!existsSync(EXPORT_PATH)) {
    return reply.status(503).send({ error: "Export not yet available" });
  }
  return reply
    .header("Content-Disposition", 'attachment; filename="export.json"')
    .type("application/json")
    .send(createReadStream(EXPORT_PATH));
});

// ---
// UPDATES
// ---

async function update() {
  const ms = 1000 * 60 * 1;
  const itemLimit = 20;

  const modifiedItems = await getLastModified(ms, itemLimit);

  if (itemLimit === modifiedItems.length) {
    flush();
  }

  if (modifiedItems.length > 0) {
    delCache(`query:per_page=100&page=1`);
  }
}

export async function flush() {
  const items = await getAllItems(true);
  await flushCache();
  await setCache("allItems", 60 * 60, items);
  await preload();
}

// ---
// PRELOAD
// ---

// Holds the active setTimeout handle for each recurring preload loop, so that
// re-running preload() (e.g. from flush()) cancels the previous chain instead
// of stacking a new one on top of it forever.
const preloadTimers = {
  filters: null,
  creators: null,
  counts: null,
  ids: null,
};

async function preload() {
  clearTimeout(preloadTimers.filters);
  clearTimeout(preloadTimers.creators);
  clearTimeout(preloadTimers.counts);
  clearTimeout(preloadTimers.ids);

  preloadFilters();
  preloadCreators();
  preloadCounts();
  preloadIds();
}

async function preloadFilters(force = false) {
  await getFilters(force);
  const ttl = await ttlCache("filters");
  preloadTimers.filters = setTimeout(preloadFilters, ttl * 0.95, true);
}

async function preloadCreators(force = false) {
  await getCreators(force);
  const ttl = await ttlCache("creators");
  preloadTimers.creators = setTimeout(preloadCreators, ttl * 0.95, true);
}

async function preloadCounts(force = false) {
  await getCounts(force);
  const ttl = await ttlCache("counts");
  preloadTimers.counts = setTimeout(preloadCounts, ttl * 0.95, true);
}

async function preloadIds(force = false) {
  await getIds(force);
  const ttl = await ttlCache("ids");
  preloadTimers.ids = setTimeout(preloadIds, ttl * 0.95, true);
}

// ---
// START SERVER
// ---

try {
  await preload();
  await server.listen({ host: API_HOST, port: API_PORT });
  await update();
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
