import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, localizeObject } from "./utils/helper.js";
import { flushCache, ttlCache } from "./redis.js";
import { ORIGIN, API_PORT, NEWSLETTER_TYPE_ID } from "./env.js";
import {
  getFilters,
  getFeatured,
  getItem,
  getItemDetails,
  queryItems,
  getHeroes,
  getPage,
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
  await flushCache();
  preload();
  return { status: "Cache flushed" };
});

// CUSTOM
server.get("/filters", async (req, res) => {
  return localizeObject(await getFilters(), req.query?.lang);
});

server.get("/featured", async (req) => {
  const featured = await getFeatured();
  if (featured.error) return reply.send(featured.error);

  const newItems = await queryItems(null, { limit: 10 });
  if (newItems.error) return reply.send(newItems.error);

  const newsletters = await queryItems(null, {
    limit: 10,
    objectType: NEWSLETTER_TYPE_ID,
  });
  if (newsletters.error) return reply.send(newsletters.error);

  const heroes = await getHeroes();
  if (heroes.error) return reply.send(heroes.error);

  return localizeObject(
    {
      featured,
      newItems: newItems.items,
      newsletters: newsletters.items,
      heroes,
    },
    req.query.lang
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
  const res = await queryItems(req.params.id, req.query);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, req.query.lang);
});

server.get("/page/:slug", async (req, reply) => {
  const res = await getPage(req.params.slug, req.query.lang);
  if (res.error) return reply.send(res.error);
  return res;
});

// ---
// PRELOAD
// ---

async function preload() {
  preloadFilters();
  preloadCreators();
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

// ---
// START SERVER
// ---

try {
  await preload();
  await server.listen({ port: API_PORT });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
