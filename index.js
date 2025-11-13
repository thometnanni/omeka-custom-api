import dotenv from "dotenv";
import cors from "@fastify/cors";
import fastify from "fastify";
import Parser from "rss-parser";
import he from "he";
import {
  parseOrigin,
  makeCacheKey,
  flattenProperty,
  localizeObject,
  flattenLinkedProperties,
  flattenType,
  filterQuery,
  types,
  parseQuery,
  formatItem,
  formatItemDetailed,
  formatMedia,
  formatItemFilters,
  filterMediaByLang,
} from "./utils.js";
import { flushCache, getCache, setCache, ttlCache } from "./redis.js";

// ---
// SETUP
// ---
// ENV
dotenv.config();
const { ORIGIN, OMEKA_API, API_PORT = 3000, PAGE_LIMIT = 100 } = process.env;

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
  const cached = await getCache("allItems");
  if (cached) return cached;
  const allItems = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${OMEKA_API}/items?page=${page}&per_page=${PAGE_LIMIT}`
    );
    const data = await response.json();

    if (data.length === 0) break;

    allItems.push(...data);
    console.log(`Fetched page ${page}, total items so far: ${allItems.length}`);

    page++;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return await setCache("allItems", 60 * 60, allItems);
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
async function getFilterByType(type) {
  const { term, property } = types[type];
  const allItems = await getAllItems();

  const items = allItems
    .filter((item) => item["@type"].includes(term))
    .map((item) => {
      const title = flattenProperty(item["dcterms:title"]);
      const id = item["o:id"];
      const count = allItems.filter((item) =>
        item[property]?.find((creator) => creator.value_resource_id === id)
      ).length;
      return {
        id,
        title,
        count,
      };
    })
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);

  return items;
}

// FILTERS
async function getFilters(force = false) {
  const cached = await getCache("/filters");
  if (cached && !force) return cached;
  const filters = {
    year: await getFilterYears(),
    creator: await getFilterByType("creator"),
    objectType: await getFilterByType("objectType"),
    theme: await getFilterByType("theme"),
    era: await getFilterByType("era"),
  };
  return await setCache("/filters", 60 * 60 * 24, filters);
}

// NEWSLETTERS
async function getNewsletters() {
  const cached = await getCache("/newsletters");
  if (cached) return cached;

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
  return await setCache("/newsletters", 60 * 60 * 24, newsletters);
}

// FEATURED
async function getFeatured() {
  const cached = await getCache("/featured");
  if (cached) return cached;
  const filters = await getFilters();
  const featured = await fetch(`${OMEKA_API}/items?item_set_id=4322`).then(
    (d) =>
      d.json().then((items) => {
        return items.map((item) => ({
          id: item["o:id"],
          type: flattenType(item),
          title: flattenProperty(item["dcterms:title"]),
          ...flattenLinkedProperties(item, filters),
          thumbnail: item.thumbnail_display_urls?.medium,
        }));
      })
  );

  return await setCache("/featured", 60 * 60 * 24, featured);
}

// SPASH IMAGE
async function getSplashImages() {
  const cached = await getCache("/splash-images");
  if (cached) return cached;
  const splashImages = await fetch(`${OMEKA_API}/items?item_set_id=4329`).then(
    (d) =>
      d.json().then((items) => {
        return items.map((item) => item.thumbnail_display_urls?.large);
      })
  );

  return await setCache("/splash-images", 60 * 60 * 24 * 7, splashImages);
}

// ITEMS
async function getItem(id = null, query) {
  const queryString = parseQuery(query, 1);
  const cached = await getCache(`/item/${id ?? ""}?${queryString}`);
  if (cached) return cached;
  const filters = await getFilters();
  const search =
    typeof query?.search === "string" && query.search.trim()
      ? query.search.trim()
      : null;
  let item = {};
  if (id != null) {
    item = await fetch(`${OMEKA_API}/items/${id}`).then((d) =>
      d.json().then((r) => formatItemDetailed(r, filters, search))
    );
    if (item.media) {
      const promises = item.media.map(
        async (mid) =>
          await fetch(`${OMEKA_API}/media/${mid}`).then((d) => d.json())
      );
      const media = await Promise.all(promises);
      item.media = media.map(formatMedia);
    }
  }
  const hasItems = id == null || Object.keys(types).includes(item.type);
  if (hasItems) {
    let url = `${OMEKA_API}/items?sort_by=created&sort_order=desc&per_page=${PAGE_LIMIT}&${queryString}`;
    if (id != null) {
      const type = Object.entries(types).find(([key]) => key === item.type)[1];
      url = `${url}&${filterQuery(type.property, item.id)}`;
    }
    item.items = await fetch(url).then((d) =>
      d
        .json()
        .then((items) => items.map((it) => formatItem(it, filters, search)))
    );
    if (queryString || id != null) {
      if (item.items.length < PAGE_LIMIT) {
        item.filters = formatItemFilters(item.items, filters);
      } else {
        const cached = await getCache(`FILTERS:${url}`);
        if (cached) {
          item.filters = cached;
        } else {
          let page = 2;
          while (true) {
            const batch = await fetch(`${url}&page=${page}`).then((d) =>
              d
                .json()
                .then((items) =>
                  items.map((it) => formatItem(it, filters, search))
                )
            );
            item.items.push(...batch);
            page++;
            if (batch.length < PAGE_LIMIT) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const formattedItemFilters = formatItemFilters(item.items, filters);
          item.filters = await setCache(
            `FILTERS:${url}`,
            60 * 60 * 24 * 7,
            formattedItemFilters
          );
        }
      }
    }
  }
  return await setCache(`/item/${id}?${queryString}`, 60 * 60 * 12, item);
}

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

// PASS THROUGH
server.get("/omeka/*", async (req, res) => {
  const path = req.params["*"];
  const query = new URLSearchParams(req.query).toString();
  const url = `${OMEKA_API}/${path}?${query}`;

  const cacheKey = makeCacheKey(req);
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const options = {
    method: req.method,
    headers: { "Content-Type": "application/json" },
  };

  const response = await fetch(url, options).then((res) => res);

  const data = await response.json();

  await setCache(cacheKey, 60 * 60, data);

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
