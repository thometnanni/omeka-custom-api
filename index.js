import dotenv from "dotenv";
import { createClient } from "redis";
import cors from "@fastify/cors";
import fastify from "fastify";

// Load environment variables from .env into process.env
dotenv.config();

const server = fastify({});
const { REDIS_HOST, REDIS_PORT, ORIGIN, OMEKA_API } = process.env;

await server.register(cors, {
  origin: ORIGIN.match(/(?:\/.*?\/|[^,])+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((str) => new RegExp(str.replace(/^\//, "").replace(/\/$/, ""))),
});

// Redis setup
const redisClient = createClient({
  host: REDIS_HOST,
  port: REDIS_PORT,
});
redisClient.on("error", (err) => console.error("Redis Client Error", err));
redisClient.connect();

// Helper: cache key based on method + URL + query/body
function makeCacheKey(req) {
  const base = req.originalUrl;
  const body = req.method === "GET" ? "" : JSON.stringify(req.body);
  return `${req.method}:${base}:${Buffer.from(body).toString("base64")}`;
}

server.all("/flush", async () => {
  await redisClient.flushAll();
  return { status: "Cache flushed" };
});

// Declare a route
server.get("/omeka-api/*", async function handler(req, reply) {
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

  await redisClient.setEx(cacheKey, 600, JSON.stringify(data));

  reply
    .code(response.status)
    .header("Content-Type", "application/json; charset=utf-8")
    .send(data);
});

// Run the server!
try {
  await server.listen({ port: 3000 });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
