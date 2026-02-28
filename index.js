import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, localizeObject } from "./utils/helper.js";
import { delCache, ttlCache } from "./redis.js";
import { ORIGIN, API_PORT, API_HOST, NEWSLETTER_TYPE_ID } from "./env.js";
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
  flush,
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
server.all("/flush", async () => {
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
    { retrieveCreators: false },
  );
  if (newItems.error) return reply.send(newItems.error);

  const newsletters = await queryItems(
    null,
    {
      limit: 20,
      objectType: NEWSLETTER_TYPE_ID,
    },
    { retrieveCreators: false },
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

  setTimeout(preloadFilters, ms, true);
}

// ---
// PRELOAD
// ---

async function preload() {
  preloadFilters();
  preloadCreators();
  preloadCounts();
}

async function preloadFilters(force = false) {
  await getFilters(force);
  const ttl = await ttlCache("filters");
  setTimeout(preloadFilters, ttl * 0.95, true);
}

async function preloadCreators(force = false) {
  await getCreators(force);
  const ttl = await ttlCache("creators");
  setTimeout(preloadCreators, ttl * 0.95, true);
}

async function preloadCounts(force = false) {
  await getCounts(force);
  const ttl = await ttlCache("counts");
  setTimeout(preloadCounts, ttl * 0.95, true);
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
