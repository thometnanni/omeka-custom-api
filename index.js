import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, localizeObject, filterMediaByLang } from "./utils.js";
import { flushCache, ttlCache } from "./redis.js";
import { ORIGIN, API_PORT } from "./env.js";
import {
  getFilters,
  getNewsletters,
  getFeatured,
  getSplashImages,
  getItem,
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

server.get("/items", async (req, res) => {
  const lang =
    typeof req.query?.lang === "string" && req.query.lang !== ""
      ? req.query.lang
      : null;
  const item = await getItem(null, req.query);
  return localizeObject(filterMediaByLang(item, lang), lang);
});

server.get("/items/:id(^[0-9]+$)", async (req, res) => {
  const lang =
    typeof req.query?.lang === "string" && req.query.lang !== ""
      ? req.query.lang
      : null;
  const item = await getItem(req.params.id, req.query);
  return localizeObject(filterMediaByLang(item, lang), lang);
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
