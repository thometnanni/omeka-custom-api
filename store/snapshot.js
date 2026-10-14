import { types } from "../types.js";
import { FEATURED_ITEM_SET, HEROES_ITEM_SET } from "../env.js";
import {
  linkedIds,
  normalizeHero,
  normalizeOmekaFields,
  normalizePage,
  normalizeType,
  normalizeValue,
} from "../utils/normalize.js";
import { localizeObject } from "../utils/helper.js";
import { COLLATORS, SUPPORTED_LANGUAGES } from "../utils/languages.js";
import { fold } from "../query/search.js";

// properties that get their own search field (or none at all)
const SEARCH_FIELDS = {
  "dcterms:title": "title",
  "dcterms:alternative": "title",
  "curation:number": "number",
  "dcterms:description": "description",
  "extracttext:extracted_text": "text",
};
const LINK_PROPERTIES = new Set(Object.values(types).map((t) => t.property));

let generationCounter = 0;

/**
 * Per raw item data that does not depend on other items. Raw items are
 * replaced (never mutated) when they change, so this can be memoized by object
 * identity and incremental rebuilds only prepare changed items.
 * @type {WeakMap<Object, Object>}
 */
const prepared = new WeakMap();

function prepareItem(raw) {
  let prep = prepared.get(raw);
  if (prep) return prep;

  const search = { title: [], number: [], description: [], text: [], other: [] };
  const refs = new Set();

  for (const [property, values] of Object.entries(raw)) {
    if (!Array.isArray(values) || property.startsWith("o:")) continue;
    for (const value of values) {
      if (value?.value_resource_name === "items") refs.add(value.value_resource_id);

      const field = SEARCH_FIELDS[property] ?? "other";
      if (value?.["@value"] != null) {
        search[field].push(String(value["@value"]));
      } else if (value?.display_title && !LINK_PROPERTIES.has(property)) {
        // linked titles of filter types are indexed per snapshot, as they can change
        search.other.push(value.display_title);
      }
    }
  }

  // descriptions and extracted texts are folded once and reused for snippets
  const foldTexts = (property) =>
    (raw[property] ?? [])
      .map((value) => value?.["@value"])
      .filter((text) => typeof text === "string" && text.trim().length > 0)
      .map((text) => ({ text: text.trim(), folded: fold(text.trim()) }));
  const descriptions = foldTexts("dcterms:description");
  const texts = foldTexts("extracttext:extracted_text");
  search.description = descriptions.map(({ folded }) => folded);
  search.text = texts.map(({ folded }) => folded);

  prep = {
    id: raw["o:id"],
    type: normalizeType(raw),
    terms: new Set([raw["@type"]].flat()),
    isPart: raw["dcterms:isPartOf"] != null,
    created: Date.parse(raw["o:created"]?.["@value"]) || 0,
    modified: raw["o:modified"]?.["@value"] ?? "",
    years: [
      ...new Set(
        (raw["dcterms:date"] ?? [])
          .map((date) => String(date["@value"] ?? "").split("-")[0])
          .filter(Boolean),
      ),
    ],
    links: Object.fromEntries(
      Object.entries(types).map(([name, { property }]) => [
        name,
        linkedIds(raw, property) ?? [],
      ]),
    ),
    refs: [...refs],
    itemSets: (raw["o:item_set"] ?? []).map((set) => set["o:id"]),
    title: normalizeValue(raw["dcterms:title"]),
    snippetSources: [...descriptions, ...texts],
    search: Object.fromEntries(
      Object.entries(search).map(([field, values]) => [
        field,
        field === "description" || field === "text"
          ? values.join("\n")
          : fold(values.join("\n")),
      ]),
    ),
  };
  prepared.set(raw, prep);
  return prep;
}

/**
 * Build an immutable snapshot with all indexes and precomputed responses.
 * @param {Object[]} rawItems - raw items from the Omeka API
 * @param {Object[]} [rawPages] - raw site pages from the Omeka API
 * @returns {Object}
 */
export function buildSnapshot(rawItems, rawPages = []) {
  const preps = new Map(
    rawItems
      .map(prepareItem)
      .sort((a, b) => a.id - b.id)
      .map((prep) => [prep.id, prep]),
  );

  const resolveLink = (id, name) => {
    const linked = preps.get(id);
    if (linked == null || !linked.terms.has(types[name].term)) return;
    return { title: linked.title, id };
  };

  // RECORDS
  const rawById = new Map(rawItems.map((raw) => [raw["o:id"], raw]));
  const records = new Map();
  for (const prep of preps.values()) {
    const record = { ...prep, search: { ...prep.search } };
    records.set(prep.id, record);

    record.raw = rawById.get(record.id);
    record.item = normalizeOmekaFields(record.raw, resolveLink);
    record.search.linked = fold(
      Object.entries(record.links)
        .flatMap(([name, ids]) => ids.map((id) => resolveLink(id, name)))
        .filter(Boolean)
        .flatMap(({ title }) =>
          title != null && typeof title === "object"
            ? Object.values(title)
            : [title],
        )
        .join("\n"),
    );
  }

  // INDEXES
  const linked = Object.fromEntries(Object.keys(types).map((name) => [name, new Map()]));
  const years = new Map();
  const reverse = new Map();
  const addTo = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };

  for (const record of records.values()) {
    for (const [name, ids] of Object.entries(record.links)) {
      ids.forEach((id) => addTo(linked[name], id, record.id));
    }
    record.years.forEach((year) => addTo(years, year, record.id));
    record.refs.forEach((id) => addTo(reverse, id, record.id));
  }

  // ORDERS
  const all = [...records.values()];
  const byCreated = all.toSorted((a, b) => b.created - a.created || b.id - a.id);

  for (const lang of SUPPORTED_LANGUAGES) {
    all
      .map((record) => ({ record, title: String(localizeObject(record.title, lang) ?? "") }))
      .sort((a, b) => COLLATORS[lang].compare(a.title, b.title) || a.record.id - b.record.id)
      .forEach(({ record }, rank) => {
        record.titleRank ??= {};
        record.titleRank[lang] = rank;
      });
  }

  // PRECOMPUTED RESPONSES
  const notParts = all.filter(({ isPart }) => !isPart);

  return {
    generation: `${Date.now().toString(36)}-${++generationCounter}`,
    builtAt: new Date().toISOString(),
    size: records.size,
    records,
    byCreated,
    linked,
    years,
    reverse,
    filters: globalFilters(notParts),
    counts: {
      creators: notParts.filter(({ type }) => type === "creator").length,
      objects: notParts.filter(({ type }) => type === "object").length,
    },
    ids: Object.fromEntries(all.map(({ id, modified }) => [id, modified.split("T")[0]])),
    featured: all
      .filter(({ itemSets }) => itemSets.includes(FEATURED_ITEM_SET))
      .map(({ item }) => item),
    heroes: all
      .filter(({ itemSets }) => itemSets.includes(HEROES_ITEM_SET))
      .map(({ raw }) => normalizeHero(raw)),
    pages: buildPages(rawPages),
    fullItem(id) {
      const record = records.get(id);
      if (record == null) return null;
      return normalizeOmekaFields(record.raw, resolveLink, {
        description: true,
        heroes: true,
        items: reverse.has(id) ? [...reverse.get(id)].sort((a, b) => a - b) : null,
      });
    },
  };
}

/**
 * Facets over all items that are not part of another item.
 * @param {Object[]} records - sorted by id
 * @returns {{year: {value:string, count:number}[]} & Object.<string, {id:number, title:*, count:number}[]>}
 */
function globalFilters(records) {
  const yearCounts = new Map();
  const linkCounts = Object.fromEntries(Object.keys(types).map((name) => [name, new Map()]));

  for (const record of records) {
    for (const year of record.years) yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    for (const [name, ids] of Object.entries(record.links)) {
      for (const id of ids) linkCounts[name].set(id, (linkCounts[name].get(id) ?? 0) + 1);
    }
  }

  const byCount = (a, b) => b.count - a.count;

  return {
    year: [...yearCounts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({ value, count }))
      .sort(byCount),
    ...Object.fromEntries(
      Object.entries(types).map(([name, { term }]) => [
        name,
        records
          .filter((record) => record.terms.has(term) && linkCounts[name].has(record.id))
          .map(({ id, title }) => ({ id, title, count: linkCounts[name].get(id) }))
          .sort(byCount),
      ]),
    ),
  };
}

/**
 * Index site pages by slug. The first page with a slug wins.
 * @param {Object[]} rawPages
 * @returns {Map<string, {title:string, html:string}>}
 */
function buildPages(rawPages) {
  const pages = new Map();
  for (const page of rawPages) {
    if (!pages.has(page["o:slug"])) pages.set(page["o:slug"], normalizePage([page]));
  }
  return pages;
}
