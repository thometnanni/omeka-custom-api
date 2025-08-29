import dotenv from "dotenv";
import { createClient } from "redis";
import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin, makeCacheKey } from "./utils.js";

// ---
// SETUP
// ---
// ENV
dotenv.config();
const {
  REDIS_HOST = "localhost",
  REDIS_PORT = 6379,
  ORIGIN,
  OMEKA_API,
  API_PORT = 3000,
} = process.env;

// REDIS
const redisClient = createClient({
  host: REDIS_HOST,
  port: REDIS_PORT,
});
redisClient.on("error", (err) => console.error("Redis Client Error", err));
redisClient.connect();

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
  await redisClient.flushAll();
  return { status: "Cache flushed" };
});

// CUSTOM
server.get("/filters", async (req, res) => {
  const cached = await redisClient.get("/filters");
  if (cached) return JSON.parse(cached);

  const allItems = [];
  let page = 1;
  const perPage = 100; // reasonable batch size

  while (true) {
    const response = await fetch(
      `${OMEKA_API}/items?page=${page}&per_page=${perPage}`
    );
    const data = await response.json();

    if (data.length === 0) break; // no more items

    allItems.push(...data);
    console.log(`Fetched page ${page}, total items so far: ${allItems.length}`);

    page++;

    // Optional: small delay to be extra nice to the server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const years = {};

  allItems.forEach((item) => {
    console.log(item["dcterms:date"]);
    const year = item["dcterms:date"]?.[0]?.["@value"]?.split("-")[0];
    if (!year) return;

    years[year] = 1 + (years[year] ?? 0);
  });

  const filters = {
    years,
  };
  await redisClient.setEx("/filters", 60 * 60 * 12, JSON.stringify(filters));

  return filters;
});

// PASS THROUGH
server.get("/omeka/*", async (req, res) => {
  const path = req.params["*"];
  const query = new URLSearchParams(req.query).toString();
  const url = `${OMEKA_API}/${path}?${query}`;

  const cacheKey = makeCacheKey(req);
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const options = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
  };

  const response = await fetch(url, options).then((res) => res);

  const data = await response.json();

  await redisClient.setEx(cacheKey, 60 * 60, JSON.stringify(data));

  res
    .code(response.status)
    .header("Content-Type", "application/json; charset=utf-8")
    .send(data);
});

// ---
// START SERVER
// ---
try {
  await server.listen({ port: API_PORT });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
