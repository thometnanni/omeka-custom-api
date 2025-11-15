import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, localizeObject } from "./utils/helper.js";
import { flushCache, ttlCache } from "./redis.js";
import { ORIGIN, API_PORT } from "./env.js";
import {
  getFilters,
  getNewsletters,
  getFeatured,
  getSplashImages,
  getItem,
  getItemDetails,
  queryItems,
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

server.get("/newsletters", async (req, res) => {
  return localizeObject(await getNewsletters(), req.query?.lang);
});

server.get("/featured", async (req, res) => {
  return localizeObject(await getFeatured(), req.query?.lang);
});

server.get("/splash-images", async (req, res) => {
  return await getSplashImages();
});

server.get("/item/:id(^[0-9]+$)", async (req, reply) => {
  const lang = req.query?.lang || null;
  const res = await getItem(req.params.id);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, lang);
});

server.get("/item-details/:id(^[0-9]+$)", async (req, reply) => {
  const lang = req.query?.lang || null;
  const res = await getItemDetails(req.params.id);
  if (res.error) return reply.send(res.error);
  return localizeObject(res, lang);
});

server.get("/query/:id(^[0-9]+$)", async (req, reply) => {
  const lang = req.query?.lang || null;
  const res = await queryItems(req.params.id, req.query);

  if (res.error) return reply.send(res.error);
  return localizeObject(res, lang);
});

// ---
// PRELOAD
// ---

async function preload() {
  preloadFilters();
}

async function preloadFilters(force = false) {
  await getFilters(force);
  const ttl = await ttlCache("/filters");
  setTimeout(preloadFilters, ttl * 0.95, true);
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
