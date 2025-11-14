import he from "he";

/**
 * Mapping of domain keys to their RDF term and raw item property.
 * @type {Object.<string, {term:string, property:string}>}
 */
export const types = {
  creator: {
    term: "foaf:Person",
    property: "dcterms:creator",
  },
  objectType: {
    term: "skos:Concept",
    property: "curation:category",
  },
  theme: {
    term: "dctype:Collection",
    property: "curation:theme",
  },
  era: { term: "dctype:Event", property: "dcterms:coverage" },
};

/**
 * Filter configuration used to build query strings. Extends `types`.
 * year includes a searchType override.
 */
export const filterConfig = {
  ...types,
  year: { property: "dcterms:date", searchType: "sw" },
};

/**
 * Convert an origin string (comma-separated or slash-delimited regexes) into RegExp objects.
 * Example inputs: "https://a.example, /https:\\/\\/.*\\.example/"
 * @param {string} origin
 * @returns {RegExp[]}
 */
export function parseOrigin(origin) {
  return origin
    .match(/(?:\/.*?\/|[^,])+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((str) => new RegExp(str.replace(/^\//, "").replace(/\/$/, "")));
}

/**
 * Build a cache key for a request using method, URL and base64-encoded body (empty for GET).
 * @param {Object} req - Express-like request object
 * @returns {string}
 */
export function makeCacheKey(req) {
  const base = req.originalUrl;
  const body = req.method === "GET" ? "" : JSON.stringify(req.body);
  return `${req.method}:${base}:${Buffer.from(body).toString("base64")}`;
}

/**
 * Normalize a property value from the API into a string, a language-indexed object,
 * or leave it as-is for non-standard shapes.
 * - If property is an array with length > 1: returns { langCode: value, ... }
 * - Otherwise returns the first "@value" or the value itself, trimmed where possible.
 * @param {*} property
 * @returns {string|Object|*}
 */
export function flattenProperty(property) {
  if (Array.isArray(property) && property.length > 1) {
    return Object.fromEntries(
      property.map((p) => [p["@language"], p["@value"].trim?.()] ?? p["@value"])
    );
  }
  const value = property?.[0]?.["@value"] ?? property?.["@value"] ?? property;
  return value?.trim?.() ?? value;
}

/**
 * For each known linked type, map the raw item's linked resources to an array of {title,id}.
 * Uses the provided filters lookup to resolve canonical titles by resource id.
 * @param {Object} item - raw item from API
 * @param {Object} filters - lookup of available filters keyed by type name
 * @returns {Object.<string, Array<{title?:string,id?:*}>>}
 */
export function flattenLinkedProperties(item, filters) {
  return Object.fromEntries(
    Object.entries(types).map(([name, type]) => {
      const values = item[type.property]?.map(({ value_resource_id }) => {
        const { title, id } =
          filters[name]?.find(({ id }) => id === value_resource_id) ?? {};
        return {
          title,
          id,
        };
      });
      return [name, values];
    })
  );
}

/**
 * Determine the content type key for an item by matching its @type to entries in `types`.
 * Returns a key like "creator", "objectType", etc., or "object" as a fallback.
 * @param {Object} item
 * @returns {string}
 */
export function flattenType(item) {
  const term = [item["@type"]]?.flat()?.find((type) =>
    Object.values(types)
      .map(({ term }) => term)
      .includes(type)
  );

  const type = Object.entries(types).find(
    ([, type]) => type.term === term
  )?.[0];

  return type ?? "object";
}

/**
 * Recursively localize an object to a preferred language code.
 * - If obj is a language-keyed map (all keys length 2) return obj[lang] or a fallback.
 * - Otherwise traverse the object/array and localize nested values.
 * @param {*} obj
 * @param {string|null} lang
 * @returns {*}
 */
export function localizeObject(obj, lang) {
  if (lang == null) return obj;
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Object.keys(obj).every((key) => key.length === 2)) {
    return obj[lang] || obj[Object.keys(obj)[0]] || obj;
  }

  return Object.entries(obj).reduce(
    (result, [key, value]) => {
      result[key] = localizeObject(value, lang);
      return result;
    },
    Array.isArray(obj) ? [] : {}
  );
}

/**
 * Build a single property[] query fragment used by the API.
 * Example: property[0][property]=dcterms:creator&property[0][type]=res&property[0][text]=Smith
 * @param {string} property
 * @param {string} value
 * @param {number} [index=0]
 * @param {string} [type="res"]
 * @returns {string}
 */
export function filterQuery(property, value, index = 0, type = "res") {
  return `property[${index}][property]=${property}&property[${index}][type]=${type}&property[${index}][text]=${value}`;
}

/**
 * Convert a query object with comma-separated filter values into an API query string.
 * Supports objectType, creator, theme, era, year and optional fulltext_search via query.search.
 * @param {Object} query
 * @param {number} [offset=0] - starting index for property[] blocks
 * @returns {string}
 */
export function parseQuery(query, offset = 0) {
  const filters = {
    objectType: (query?.objectType?.split(",") ?? []).sort(),
    creator: (query?.creator?.split(",") ?? []).sort(),
    theme: (query?.theme?.split(",") ?? []).sort(),
    era: (query?.era?.split(",") ?? []).sort(),
    year: (query?.year?.split(",") ?? []).sort(),
  };

  const queryStrings = Object.entries(filters)
    .map(([type, values]) =>
      values.map((value) => {
        return {
          property: filterConfig[type].property,
          searchType: filterConfig[type].searchType,
          value,
        };
      })
    )
    .flat()
    .map(({ property, value, searchType }, i) =>
      filterQuery(property, value, offset + i, searchType)
    );

  const search = query?.search?.trim();

  if (search) {
    queryStrings.push(`fulltext_search=${encodeURIComponent(search)}`);
  }
  return queryStrings.join("&");
}

/**
 * Format a raw item into a compact summary used by the API responses.
 * Includes id, type, title, linked properties (creator, objectType, theme, era),
 * thumbnail, published and optional search snippets.
 * @param {Object} raw
 * @param {Object} filters
 * @param {string|null} [search=null]
 * @returns {Object}
 */
export function formatItem(raw, filters, search = null) {
  const title = flattenProperty(raw["dcterms:title"]);
  const description = flattenProperty(raw["dcterms:description"]);
  const titleAlt = flattenProperty(raw["dcterms:alternative"]);
  const published = flattenProperty(raw["dcterms:date"]);
  const blob = [
    textOf(title),
    textOf(description),
    textOf(titleAlt),
    linkedTitles(raw, filters),
  ]
    .filter(Boolean)
    .join(" ");
  const hits = search ? extractSnippets(blob, search, 3, 80) : [];
  const snippets = hits.length
    ? Array.from(new Set(hits)).slice(0, 3)
    : undefined;
  return {
    id: raw["o:id"],
    type: flattenType(raw),
    title,
    ...flattenLinkedProperties(raw, filters),
    thumbnail: raw.thumbnail_display_urls?.medium,
    published,
    ...(snippets ? { snippets } : {}),
  };
}

/**
 * Normalize a media object:
 * - decode html if present, generate plain text version,
 * - detect language from several possible fields,
 * - return only present properties.
 * @param {Object} media
 * @returns {Object}
 */
export function formatMedia(media) {
  const rawHtml = media?.data?.html ?? media?.["o-cnt:chars"];
  const html = rawHtml ? he.decode(rawHtml) : null;
  const text = html ? htmlToPlainText(html) : null;
  const rawLang =
    media?.["o:lang"] ??
    media?.["o:language"] ??
    media?.["dcterms:language"]?.[0]?.["@value"];
  const lang = typeof rawLang === "string" && rawLang.length ? rawLang : null;
  return {
    filename: media["o:source"],
    url: media["o:original_url"],
    type: media["o:media_type"],
    ...(lang ? { lang } : {}),
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  };
}

/**
 * Build a detailed item representation by extending formatItem with media ids,
 * alternative title and full description.
 * @param {Object} raw
 * @param {Object} filters
 * @param {string|null} [search=null]
 * @returns {Object}
 */
export function formatItemDetailed(raw, filters, search = null) {
  const base = formatItem(raw, filters, search);
  return {
    ...base,
    media: raw["o:media"]?.map((m) => m["o:id"]),
    titleAlt: flattenProperty(raw["dcterms:alternative"]),
    description: flattenProperty(raw["dcterms:description"]),
  };
}

/**
 * Generate counts for UI filters from a list of formatted items.
 * Returns an object keyed by filter name containing counts per filter value.
 * @param {Array} items - formatted items
 * @param {Object} filters - (not used for computation, only keys are needed)
 * @returns {Object.<string, Object.<string, number>>}
 */
export function formatItemFilters(items, filters) {
  const itemFilters = Object.fromEntries(
    Object.keys(filterConfig).map((key) => [key, {}])
  );
  items.forEach((item) => {
    Object.keys(filterConfig).forEach((key) => {
      if (!item[key]) return;
      item[key].forEach((filter) => {
        const filterKey = filter.id ?? filter.value;

        itemFilters[key][filterKey] = itemFilters[key][filterKey]
          ? itemFilters[key][filterKey] + 1
          : 1;
      });

      itemFilters.year[item.published] = itemFilters.year[item.published]
        ? itemFilters.year[item.published] + 1
        : 1;
    });
  });
  return itemFilters;
}

/**
 * Convert various possible value shapes to plain text.
 * - null/undefined => ""
 * - string => string
 * - array => recursively join entries
 * - object => join Object.values recursively
 * - otherwise => String(v)
 * @param {*} v
 * @returns {string}
 */
export function textOf(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (typeof v === "object")
    return Object.values(v).map(textOf).filter(Boolean).join(" ");
  return String(v);
}

/**
 * Escape regex metacharacters in a string for safe insertion into a RegExp.
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract text snippets around matches of the query terms in the text.
 * Returns up to maxSnippets. Each snippet includes `context` characters around the match
 * and is trimmed with ellipses if truncated.
 * @param {string} text
 * @param {string} query - space-separated terms
 * @param {number} [maxSnippets=3]
 * @param {number} [context=80]
 * @returns {string[]}
 */
export function extractSnippets(text, query, maxSnippets = 3, context = 80) {
  if (!text || !query) return [];
  const terms = Array.from(
    new Set(String(query).trim().split(/\s+/).filter(Boolean))
  );
  if (!terms.length) return [];
  const re = new RegExp(terms.map(escapeRegex).join("|"), "gi");
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < maxSnippets) {
    const a = Math.max(0, m.index - context);
    const b = Math.min(text.length, m.index + m[0].length + context);
    out.push(
      (a > 0 ? "…" : "") + text.slice(a, b) + (b < text.length ? "…" : "")
    );
  }
  return out;
}

/**
 * Build a space-joined string of linked resource titles for known types.
 * Resolves canonical titles via `filters` by matching value_resource_id to filter.id.
 * @param {Object} raw
 * @param {Object} filters
 * @returns {string}
 */
export function linkedTitles(raw, filters) {
  const out = [];
  Object.entries(types).forEach(([name, type]) => {
    const vals = raw[type.property] || [];
    vals.forEach((v) => {
      const id = v?.value_resource_id;
      const m = filters[name]?.find((x) => x.id === id);
      const t = m?.title || v?.display_title || v?.["o:label"];
      if (t) out.push(String(t));
    });
  });
  return out.join(" ");
}

/**
 * Convert minimal HTML to plain text:
 * - <br> and </p> become newlines
 * - other tags removed, whitespace collapsed
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter an item's media array to the given language. Keeps media without a lang tag.
 * If filter has no effect (empty result or identical length) returns the original item.
 * @param {Object} item - formatted item with media array
 * @param {string|null} lang
 * @returns {Object}
 */
export function filterMediaByLang(item, lang) {
  // console.log(item, lang);
  if (!lang || !item?.media) return item;
  console.log(item?.media);
  const filtered = item.media.filter(({ lang: mediaLang }) => {
    if (!mediaLang) return true;
    return mediaLang === lang;
  });
  if (!filtered.length || filtered.length === item.media.length) {
    return item;
  }
  return {
    ...item,
    media: filtered,
  };
}
