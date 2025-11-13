import dotenv from "dotenv";
import { createClient } from "redis";

dotenv.config();
const { REDIS_HOST = "localhost", REDIS_PORT = 6379 } = process.env;

// REDIS
const redisClient = createClient({
  socket: {
  host: REDIS_HOST,
  port: REDIS_PORT,
  },
});
redisClient.on("error", (err) => console.error("Redis Client Error", err));
redisClient.connect();

export async function getCache(key) {
  const cached = await redisClient.get(key);
  return cached ? JSON.parse(cached) : null;
}

export async function setCache(key, seconds, json) {
  await redisClient.setEx(key, seconds, JSON.stringify(json));
  return json;
}

export async function flushCache() {
  await redisClient.flushAll();
}

export async function ttlCache(key) {
  return await redisClient.ttl(key);
}
