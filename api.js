import Parser from "rss-parser";
import he from "he";
import {
  normalizeValue,
  resolveLinkedProperties,
  flattenType,
  types,
  parseQuery,
  normalizeMedia,
  normalizeHtml,
  formatItemFilters,
  parseOmekaFields,
  extractSnippets,
} from "./utils.js";
import { OMEKA_API, PAGE_LIMIT } from "./env.js";
import { getCache, setCache } from "./redis.js";

let awaitingAllItems = false;

export async function getAllItems() {
  const cached = await getCache("allItems");
  if (cached) return cached;
  if (awaitingAllItems) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await getAllItems();
  }
  awaitingAllItems = true;
  const timeout = setTimeout(() => (awaitingAllItems = false), 1000 * 30);

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

  awaitingAllItems = false;
  clearTimeout(timeout);
  return await setCache("allItems", 60 * 60, allItems);
}

// FILTER: YEARS
export async function getFilterYears() {
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
export async function getFilterByType(type) {
  const { term, property } = types[type];
  const allItems = await getAllItems();

  const items = allItems
    .filter((item) => item["@type"].includes(term))
    .map((item) => {
      const title = normalizeValue(item["dcterms:title"]);
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
export async function getFilters(force = false) {
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
export async function getNewsletters() {
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
export async function getFeatured() {
  const cached = await getCache("/featured");
  if (cached) return cached;
  const filters = await getFilters();
  const featured = await fetch(`${OMEKA_API}/items?item_set_id=4322`).then(
    (d) =>
      d.json().then((items) => {
        return items.map((item) => ({
          id: item["o:id"],
          type: flattenType(item),
          title: normalizeValue(item["dcterms:title"]),
          ...resolveLinkedProperties(item, filters),
          thumbnail: item.thumbnail_display_urls?.medium,
        }));
      })
  );

  return await setCache("/featured", 60 * 60 * 24, featured);
}

// SPASH IMAGE
export async function getSplashImages() {
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
export async function getItem(id) {
  const cached = await getCache(`item:${id}`);
  if (cached) return cached;

  const filters = await getFilters();
  const res = await fetch(`${OMEKA_API}/items/${id}`);

  if (!res.ok) return { error: res };

  const json = await res.json();
  const item = parseOmekaFields(json, filters);

  return await setCache(`item:${id}`, 60 * 60 * 12, item);
}

export async function getItemDetails(id) {
  const cached = await getCache(`item:details:${id}`);
  if (cached) return cached;
  const item = await getItem(id);

  if (item.media == null || item.media.length === 1) return [];

  const res = await fetch(`${OMEKA_API}/media?id=${item.media.join(",")}`);

  if (!res.ok) return { error: res };

  const mediaItems = await res.json();

  const media = normalizeMedia(mediaItems);
  const html = normalizeHtml(mediaItems);

  return await setCache(`item:details:${id}`, 60 * 60 * 12, { media, html });
}

export async function queryItems(id, query = {}) {
  if (id != null) {
    const item = await getItem(id);
    if (!Object.keys(types).includes(item.type)) return {};
    query[item.type] = query[item.type] ? `${query[item.type]},${id}` : id;
  }

  const queryString = parseQuery(query);
  const cached = await getCache(`query:${queryString}`);
  // if (cached) return cached;

  const url = `${OMEKA_API}/items?sort_by=created&sort_order=desc&per_page=${PAGE_LIMIT}&${queryString}`;
  const res = await fetch(url);

  if (!res.ok) return { error: res };
  const filters = await getFilters();

  const json = await res.json();
  const items = json.map((item) => {
    item = parseOmekaFields(item, filters, { text: true });
    if (query.search) {
      item.snippets = extractSnippets(item, query.search);
    }
    delete item.text;

    return item;
  });

  const queryFilters = queryString ? formatItemFilters(items) : filters;

  return await setCache(`/item/${id}?${queryString}`, 60 * 60 * 12, {
    items,
    filters: queryFilters,
  });
}
