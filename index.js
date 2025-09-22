import dotenv from "dotenv";
import { createClient } from "redis";
import cors from "@fastify/cors";
import fastify from "fastify";
import Parser from "rss-parser";
import he from "he";
import {
  parseOrigin,
  makeCacheKey,
  flattenProperty,
  localizeObject,
} from "./utils.js";

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
// QUERIES
// ---
// ALL ITEMS
async function getAllItems() {
  const cached = await redisClient.get("allItems");
  if (cached) return JSON.parse(cached);
  const allItems = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `${OMEKA_API}/items?page=${page}&per_page=${perPage}`
    );
    const data = await response.json();

    if (data.length === 0) break;

    allItems.push(...data);
    console.log(`Fetched page ${page}, total items so far: ${allItems.length}`);

    page++;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await redisClient.setEx("allItems", 60 * 60, JSON.stringify(allItems));
  return allItems;
}

// FILTER: YEARS
async function getFilterYears() {
  const allItems = await getAllItems();
  const years = {};

  allItems.forEach((item) => {
    const year = item["dcterms:date"]?.[0]?.["@value"]?.split("-")[0];
    if (!year) return;

    years[year] = 1 + (years[year] ?? 0);
  });

  const structuredYears = Object.entries(years)
    .map(([value, count]) => ({
      value,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return structuredYears;
}

// FILTER: BY TYPE
async function getFilterByType(type, relation) {
  const allItems = await getAllItems();

  const creators = allItems
    .filter((item) => item["@type"].includes(type))
    .map((item) => {
      const title = flattenProperty(item["dcterms:title"]);
      const id = item["o:id"];
      const count = allItems.filter((item) =>
        item[relation]?.find((creator) => creator.value_resource_id === id)
      ).length;
      return {
        id,
        title,
        count,
      };
    })
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);

  return creators;
}

// FILTERS
async function getFilters(force = false) {
  const cached = await redisClient.get("/filters");
  if (cached && !force) return JSON.parse(cached);
  const filters = {
    years: await getFilterYears(),
    creators: await getFilterByType("foaf:Person", "dcterms:creator"),
    types: await getFilterByType("skos:Concept", "curation:category"),
    themes: await getFilterByType("dctype:Collection", "curation:theme"),
    eras: await getFilterByType("dctype:Event", "dcterms:coverage"),
  };
  await redisClient.setEx("/filters", 60 * 60 * 24, JSON.stringify(filters));
  return filters;
}

// NEWSLETTERS
async function getNewsletters() {
  const cached = await redisClient.get("/newsletters");
  if (cached) return JSON.parse(cached);

  const parser = new Parser({
    customFields: {
      item: ["description"],
    },
  });
  const feed = await parser.parseURL(
    "https://chinaunofficialarchives.substack.com/feed"
  );

  const newsletters = {
    url: feed.link,
    items: feed.items.map((item) => ({
      title: {
        zh: he.decode(item.title),
        en: he.decode(item.description),
      },
      date: item.isoDate,
      url: item.link,
      image: item.enclosure?.url,
    })),
  };
  await redisClient.setEx(
    "/newsletters",
    60 * 60 * 24,
    JSON.stringify(newsletters)
  );
  return newsletters;
}

// FEATURED
async function getFeatured() {
  const cached = await redisClient.get("/featured");
  if (cached) return JSON.parse(cached);
  const featured = await fetch(`${OMEKA_API}/items?item_set_id=4322`).then(
    (d) =>
      d.json().then((items) => {
        return items.map((item) => ({
          id: item["o:id"],
          title: flattenProperty(item["dcterms:title"]),
          type: flattenProperty(item["dcterms:type"]),
          thumbnail: item.thumbnail_display_urls?.medium,
        }));
      })
  );

  await redisClient.setEx("/featured", 60 * 60 * 24, JSON.stringify(featured));
  return featured;
}

// SPASH IMAGE
async function getSplashImages() {
  const cached = await redisClient.get("/splash-images");
  if (cached) return JSON.parse(cached);
  const splashImages = await fetch(`${OMEKA_API}/items?item_set_id=4329`).then(
    (d) =>
      d.json().then((items) => {
        return items.map((item) => item.thumbnail_display_urls?.large);
      })
  );

  await redisClient.setEx(
    "/splash-images",
    60 * 60 * 24 * 7,
    JSON.stringify(splashImages)
  );
  return splashImages;
}

// ITEMS
async function getItems() {
  const cached = await redisClient.get("/items");
  if (cached) return JSON.parse(cached);
  const items = await fetch(
    `${OMEKA_API}/items?sort_by=created&sort_order=desc&per_page=100`
  ).then((d) =>
    d.json().then((items) => {
      return items.map((item) => ({
        id: item["o:id"],
        title: flattenProperty(item["dcterms:title"]),
        type: flattenProperty(item["dcterms:type"]),
        thumbnail: item.thumbnail_display_urls?.medium,
      }));
    })
  );

  await redisClient.setEx("/items", 60 * 60, JSON.stringify(items));
  return items;
}

// ---
// ROUTES
// ---
// FLUSH
server.all("/flush", async () => {
  await redisClient.flushAll();
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
  return localizeObject(await getItems(), req.query?.lang);
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
// PRELOAD
// ---

async function preload() {
  preloadFilters();
}

async function preloadFilters(force = false) {
  await getFilters(force);
  const ttl = await redisClient.ttl("/filters");
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
