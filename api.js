import { types } from "./types.js";
import {
  normalizeValue,
  normalizeMedia,
  normalizeHtml,
  normalizeItemFilters,
  normalizeOmekaFields,
  normalizeHero,
  normalizePage,
  normalizeSearchString,
  normalizeType,
} from "./utils/normalize.js";
import { parseQuery } from "./utils/query.js";
import { extractSnippets } from "./utils/snippets.js";
import {
  FEATURED_ITEM_SET,
  HEROES_ITEM_SET,
  OMEKA_API,
  OMEKA_SITE,
  PAGE_LIMIT,
} from "./env.js";
import { delCache, getCache, setCache } from "./redis.js";
import { retrieveCreators } from "./utils/retrieve.js";
import { localizeObject } from "./utils/helper.js";

const collators = {
  en: new Intl.Collator("en", { sensitivity: "base", numeric: true }),
  zh: new Intl.Collator("zh-Hans-u-co-pinyin", {
    sensitivity: "base",
    numeric: true,
  }),
};

let awaitingAllItems = false;

export async function getAllItems(force) {
  const cached = await getCache("allItems");
  if (cached && !force) return cached;
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
      `${OMEKA_API}/items?page=${page}&per_page=${PAGE_LIMIT}`,
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
export async function getFilterYears(allItems) {
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
export async function getFilterByType(type, allItems) {
  const { term, property } = types[type];

  const items = allItems
    .filter((item) => item["@type"].includes(term))
    .map((item) => {
      const title = normalizeValue(item["dcterms:title"]);
      const id = item["o:id"];
      const count = allItems.filter((item) =>
        item[property]?.find((creator) => creator.value_resource_id === id),
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
  const cached = await getCache("filters");
  if (cached && !force) return cached;

  const allItems = await getAllItems();
  const allItemsButIssues = allItems.filter(
    ({ "dcterms:isPartOf": isPartOf }) => !isPartOf,
  );

  const filters = {
    year: await getFilterYears(allItemsButIssues),
    creator: await getFilterByType("creator", allItemsButIssues),
    objectType: await getFilterByType("objectType", allItemsButIssues),
    theme: await getFilterByType("theme", allItemsButIssues),
    era: await getFilterByType("era", allItemsButIssues),
  };
  return await setCache("filters", 60 * 60 * 24, filters);
}

export async function getCreators(force = false) {
  const cached = await getCache("creators");
  if (cached && !force) return cached;

  const allItems = await getAllItems();

  const creators = allItems
    .filter((item) => item["@type"].includes(types.creator.term))
    .map(normalizeOmekaFields);

  return await setCache("creators", 60 * 60 * 24, creators);
}

export async function getCounts(force = false) {
  const cached = await getCache("counts");
  if (cached && !force) return cached;

  const allItems = await getAllItems();
  const allItemsButIssues = allItems.filter(
    ({ "dcterms:isPartOf": isPartOf }) => !isPartOf,
  );

  const types = allItemsButIssues.map(normalizeType);

  const counts = {
    creators: types.filter((type) => type === "creator").length,
    objects: types.filter((type) => type === "object").length,
  };
  return await setCache("counts", 60 * 60 * 24, counts);
}

// FEATURED
export async function getFeatured() {
  const cached = await getCache("featured");
  if (cached) return cached;

  const url = `${OMEKA_API}/items?item_set_id=${FEATURED_ITEM_SET}`;
  const res = await fetch(url);

  if (!res.ok) return { error: res };
  const filters = await getFilters();

  const json = await res.json();
  const featured = json.map((item) => normalizeOmekaFields(item, filters));

  return await setCache("featured", 60 * 60 * 24, featured);
}

export async function getHeroes() {
  const cached = await getCache("heroes");
  if (cached) return cached;

  const url = `${OMEKA_API}/items?item_set_id=${HEROES_ITEM_SET}`;
  const res = await fetch(url);

  if (!res.ok) return { error: res };

  const json = await res.json();
  const heroes = json.map((item) => normalizeHero(item));

  return await setCache("heroes", 60 * 60 * 24 * 7, heroes);
}

// ITEMS
export async function getItem(id) {
  const cached = await getCache(`item:${id}`);
  if (cached) return cached;

  const filters = await getFilters();
  const res = await fetch(`${OMEKA_API}/items/${id}`);

  if (!res.ok) return { error: res };

  const json = await res.json();
  const item = normalizeOmekaFields(json, filters, {
    description: true,
    heroes: true,
    items: true,
  });

  return await setCache(`item:${id}`, 60 * 60 * 12, item);
}

export async function getItemDetails(id) {
  const cached = await getCache(`item:details:${id}`);
  if (cached) return cached;
  const item = await getItem(id);

  if (item.media == null || item.media.length < 1) return [];

  const res = await fetch(`${OMEKA_API}/media?id=${item.media.join(",")}`);

  if (!res.ok) return { error: res };

  const mediaItems = await res.json();

  const media = normalizeMedia(mediaItems);
  const html = normalizeHtml(mediaItems);

  return await setCache(`item:details:${id}`, 60 * 60 * 12, { media, html });
}

export async function queryItems(
  id,
  query = {},
  options = { retrieveCreators: true, removeCreators: false },
) {
  if (id != null) {
    const item = await getItem(id);
    if (item.items == null || item.items.length < 1) return {};
    query.id = item.items.join(",");
  }

  const { queryString, isFiltered, limit } = parseQuery(query);
  const cached = await getCache(`query:${queryString}`);
  if (cached) return cached;

  const url = `${OMEKA_API}/items?sort_by=created&sort_order=desc&${queryString}`;

  const res = await fetch(url);

  if (!res.ok) return { error: res };
  const filters = await getFilters();

  const json = await res.json();
  const items = json.map((item) => {
    item = normalizeOmekaFields(item, filters, {
      text: true,
      description: true,
    });
    if (normalizeSearchString(query.search).length > 0) {
      item.snippets = extractSnippets(item, query.search);
    }
    delete item.text;
    delete item.description;

    return item;
  });

  const hasNextPage = items.length >= limit;

  if (options.retrieveCreators) {
    const creators = await getCreators();
    items.push(...retrieveCreators(items, creators, id));
  }

  const ignoreParts = id == null && query.search == null;

  const creators = items.filter(({ type }) => type === "creator");
  const objects = items
    .filter(({ type }) => type === "object")
    .filter(({ isPart }) => !ignoreParts || !isPart);

  const counts = {
    creators: creators.length,
    objects: objects.length,
  };

  if (hasNextPage) {
    const totalCounts = await getCounts();
    counts.creators = totalCounts.creators;
    counts.objects = totalCounts.objects;
  }

  const queryFilters = isFiltered ? normalizeItemFilters(items) : null;

  const lang = query.lang ?? "en";
  const sortedCreators = (options.removeCreators ? [] : creators).toSorted(
    (a, b) => {
      const localA = localizeObject(a.title, lang);
      const localB = localizeObject(b.title, lang);

      return collators[lang].compare(localA, localB);
    },
  );

  const sortObjects = id != null;

  const sortedObjects =
    (sortObjects &&
      objects.toSorted((a, b) => {
        const localA = localizeObject(a.title, lang);
        const localB = localizeObject(b.title, lang);

        return collators[lang].compare(localA, localB);
      })) ||
    objects;

  return await setCache(`query:${queryString}`, 60 * 60 * 12, {
    items: [...sortedObjects, ...sortedCreators],
    filters: queryFilters,
    hasNextPage,
    counts,
  });
}

export async function queryCreators(query = {}) {
  const creators = await getCreators();

  const hasNextPage = false;
  const totalCounts = await getCounts();
  const counts = {
    ...totalCounts,
  };

  const lang = query.lang ?? "en";
  const items = creators.toSorted((a, b) => {
    const localA = localizeObject(a.title, lang);
    const localB = localizeObject(b.title, lang);

    return collators[lang].compare(localA, localB);
  });

  return {
    items,
    filters: null,
    hasNextPage,
    counts,
  };
}

export async function getPage(slug, lang) {
  const localSlug = `${slug}-${lang}`;

  const cached = await getCache(`page:${localSlug}`);
  if (cached) return cached;

  const url = `${OMEKA_API}/site_pages?site=${OMEKA_SITE}&slug=${localSlug}`;

  const res = await fetch(url);

  if (!res.ok) return { error: res };

  const json = await res.json();
  const page = normalizePage(json);

  if (page == null)
    return {
      error: {
        statusCode: 404,
        payload: "Page not found",
      },
    };

  return await setCache(`page:${localSlug}`, 60 * 60 * 24, page);
}

export async function getLastModified(ms, limit = 20) {
  const url = `${OMEKA_API}/items?sort_by=modified&sort_order=desc&per_page=${limit}&page=1`;

  const res = await fetch(url);
  if (!res.ok) return { error: res };

  const items = await res.json();

  const currentTime = new Date().getTime();

  const modifiedItems = items.filter(({ "o:modified": modified }) => {
    const itemTime = new Date(normalizeValue(modified)).getTime();
    return currentTime - itemTime < ms;
  });

  await Promise.all(
    modifiedItems.map(async ({ "o:id": id }) => {
      return await delCache(`item:details:${id}`);
    }),
  );

  return modifiedItems;
}

export async function flush() {
  const items = await getAllItems(true);
  await flushCache();
  await setCache("allItems", 60 * 60, items);
  await preload();
}
