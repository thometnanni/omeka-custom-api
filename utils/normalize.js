import he from "he";
import { types } from "../types.js";
import { omitNullish } from "./helper.js";
import { OMEKA_FILE_URL, OMEKA_FILE_URL_REPLACEMENT } from "../env.js";

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
      ]),
    );
  }

  if (Array.isArray(property)) property = property[0];

  if (property?.type === "numeric:integer") property = +property["@value"];

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
      .includes(type),
  );

  const type = Object.entries(types).find(
    ([, type]) => type.term === term,
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
        "dcterms:title": title,
      }) =>
        omitNullish({
          filename,
          url: overwriteFileUrl(url),
          type,
          title: normalizeValue(title) ?? filename?.replace(/^.+\//, ""),
        }),
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

/**
 * Normalize a raw Omeka item into the shape returned by the API.
 * @param {Object} item - raw item from the API
 * @param {(id:number, type:string) => ({title:*, id:number}|undefined)} resolveLink
 *   - looks up a linked item of the given type
 * @param {{description?:boolean, heroes?:boolean, items?:number[]}} [include]
 * @returns {Object}
 */
export function normalizeOmekaFields(item, resolveLink, include = {}) {
  return omitNullish({
    id: item["o:id"],
    title: normalizeValue(item["dcterms:title"]),
    description:
      include.description && normalizeValue(item["dcterms:description"]),
    type: normalizeType(item),
    titleAlt: normalizeValue(item["dcterms:alternative"]),
    published: normalizeValue(item["dcterms:date"]),
    media: item["o:media"]?.map((m) => m["o:id"]),
    thumbnail: overwriteFileUrl(item.thumbnail_display_urls?.medium),
    thumbnailLarge: overwriteFileUrl(item.thumbnail_display_urls?.large),
    heroes: include.heroes &&
      item.thumbnail_display_urls?.medium && [
        overwriteFileUrl(item.thumbnail_display_urls?.medium),
      ],
    items: include.items,
    isPart: item["dcterms:isPartOf"] != null || null,
    number: normalizeValue(item["curation:number"]),
    ...resolveLinkedProperties(item, resolveLink),
  });
}

export function normalizeHero(item) {
  return overwriteFileUrl(item.thumbnail_display_urls?.large);
}
/**
 * Takes an omeka page array and returns title and html
 * @param {Object} pages
 * @returns {{title:string, html:string}}
 */
export function normalizePage(pages) {
  if (pages == null || pages.length < 1) return null;
  const page = pages[0];
  const title = page["o:title"];
  const html = page["o:block"]?.find((block) => block["o:layout"] === "html")?.[
    "o:data"
  ]?.html;

  return { title, html: html == null ? null : he.decode(html) };
}

/**
 * For each known linked type, map the raw item's linked resources to an array of {title,id}.
 * @param {Object} item - raw item from API
 * @param {(id:number, type:string) => ({title:*, id:number}|undefined)} resolveLink
 * @returns {Object.<string, Array<{title?:string,id?:*}>>}
 */

export function resolveLinkedProperties(item, resolveLink) {
  return Object.fromEntries(
    Object.entries(types).map(([name, type]) => {
      const values = linkedIds(item, type.property)
        ?.map((id) => resolveLink(id, name))
        .filter(Boolean);
      return [name, values];
    }),
  );
}

/**
 * Unique ids of the items a raw item links to via a property.
 * @param {Object} item - raw item from API
 * @param {string} property - e.g. "dcterms:creator"
 * @returns {number[]|undefined} undefined if the item has no such property
 */
export function linkedIds(item, property) {
  const ids = item[property]
    ?.map(({ value_resource_id: id }) => id)
    .filter((id) => id != null);
  return ids && [...new Set(ids)];
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

export function overwriteFileUrl(url) {
  if (!OMEKA_FILE_URL_REPLACEMENT || !OMEKA_FILE_URL || !url) return url;

  return url.replace(OMEKA_FILE_URL, OMEKA_FILE_URL_REPLACEMENT);
}

