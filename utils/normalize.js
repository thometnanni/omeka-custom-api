import he from "he";
import { types, filterConfig } from "../types.js";
import { omitNullish } from "./helper.js";

/**
 * Normalize a value from the API into a language-indexed object or single value
 * - If property is an array with length > 1: returns { langCode: value, ... }
 * - Otherwise returns the first "@value" or the value itself
 * @param {*} property
 * @returns {string|Object|*}
 */

export function normalizeValue(property) {
  if (Array.isArray(property) && property.length > 1) {
    return Object.fromEntries(
      property.map(({ "@language": language, "@value": value }) => [
        language,
        safeTrim(value),
      ])
    );
  }

  if (Array.isArray(property)) property = property[0];

  return safeTrim(property?.["@value"] ?? property);
}
/**
 * Determine the content type key for an item by matching its @type to entries in `types`.
 * Returns a key like "creator", "objectType", etc., or "object" as a fallback.
 * @param {Object} item
 * @returns {string}
 */

export function normalizeType(item) {
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
 * Normalize a media items array:
 * - remove html media
 * - return normalized media array
 * @param {Object} items
 * @returns {Object}
 */

export function normalizeMedia(items) {
  const mediaItems = items
    .filter(({ "o:renderer": renderer }) => renderer !== "html")
    .map(
      ({
        "o:source": filename,
        "o:original_url": url,
        "o:media_type": type,
      }) => ({ filename, url, type })
    );

  if (mediaItems.length === 0) return null;
  return mediaItems;
}
/**
 * Normalize a html media items array:
 * - remove non html media
 * - parse language and decode html
 * - normalize return value
 * @param {Object} items
 * @returns {Object}
 */

export function normalizeHtml(items) {
  const htmlItems = items
    .filter(({ "o:renderer": renderer }) => renderer === "html")
    .map(({ data, "o:lang": lang }) => {
      const html = he.decode(data.html);
      return { "@language": lang, "@value": html };
    });

  if (htmlItems.length === 0) return null;

  return normalizeValue(htmlItems);
}

export function normalizeOmekaFields(
  item,
  filters,
  include = { text: false, description: false }
) {
  return omitNullish({
    id: item["o:id"],
    title: normalizeValue(item["dcterms:title"]),
    description:
      include.description && normalizeValue(item["dcterms:description"]),
    type: normalizeType(item),
    titleAlt: normalizeValue(item["dcterms:alternative"]),
    published: normalizeValue(item["dcterms:date"]),
    text: include.text && normalizeValue(item["extracttext:extracted_text"]),
    media: item["o:media"]?.map((m) => m["o:id"]),
    thumbnail: item.thumbnail_display_urls?.medium,
    ...resolveLinkedProperties(item, filters),
  });
}

export function normalizeHero(item) {
  return item.thumbnail_display_urls?.large;
}
/**
 * Generate counts for UI filters from a list of formatted items.
 * Returns an object keyed by filter name containing counts per filter value.
 * @param {Array} items - formatted items
 * @returns {Object.<string, Object.<string, number>>}
 */

export function normalizeItemFilters(items) {
  const itemFilters = Object.fromEntries(
    Object.keys(filterConfig).map((key) => [key, {}])
  );

  items.forEach((item) => {
    Object.keys(types).forEach((key) => {
      if (!item[key]) return;
      item[key].forEach((filter) => {
        const filterKey = filter.id ?? filter.value;

        itemFilters[key][filterKey] = itemFilters[key][filterKey]
          ? itemFilters[key][filterKey] + 1
          : 1;
      });
    });

    itemFilters.year[item.published] = itemFilters.year[item.published]
      ? itemFilters.year[item.published] + 1
      : 1;
  });
  return itemFilters;
}
/**
 * For each known linked type, map the raw item's linked resources to an array of {title,id}.
 * Uses the provided filters lookup to resolve canonical titles by resource id.
 * @param {Object} item - raw item from API
 * @param {Object} filters - lookup of available filters keyed by type name
 * @returns {Object.<string, Array<{title?:string,id?:*}>>}
 */

export function resolveLinkedProperties(item, filters) {
  return Object.fromEntries(
    Object.entries(types).map(([name, type]) => {
      const values = item[type.property]?.map(
        ({ value_resource_id: value }) => {
          const { title, id } =
            filters[name]?.find(({ id }) => id === value) ?? {};
          return {
            title,
            id,
          };
        }
      );
      return [name, values];
    })
  );
}

/**
 * Returns a trimmed string if the input is a string,
 * otherwise returns the original value unchanged.
 *
 * @param {*} value – any value you want to trim
 * @returns {*} – trimmed string or the original value
 */
function safeTrim(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}
