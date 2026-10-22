import { types } from "../types.js";
import { PAGE_LIMIT } from "../env.js";
import { normalizeLang } from "../utils/languages.js";
import { extractSnippets, parseSearch, scoreRecord } from "./search.js";

const FILTER_KEYS = [...Object.keys(types), "year"];

/**
 * Query items of a snapshot.
 * - filters are ANDed, across and within filter types
 * - `id` restricts the scope to items linking to that item
 * - parts (e.g. issues of a periodical) are hidden unless `id` or `search` is set
 * - creators are the creators matching the query plus the creators of the
 *   matching objects
 * - `view` selects whether objects or creators are returned and paginated;
 *   counts, facets and totals always cover the full match set
 *
 * @param {Object} snapshot - see store/snapshot.js
 * @param {Object} query
 * @param {number} [query.id]
 * @param {string} [query.objectType] - comma-separated ids, same for creator, theme, era
 * @param {string} [query.year] - comma-separated years
 * @param {string} [query.search] - comma-separated search terms
 * @param {"object"|"creator"} [query.view="object"]
 * @param {number} [query.page=1]
 * @param {number} [query.limit]
 * @param {string} [query.lang]
 * @returns {Object|null} null if `id` has no linked items
 */
export function queryItems(snapshot, query = {}) {
  const { id, view = "object", page = 1, limit = PAGE_LIMIT } = query;
  const lang = normalizeLang(query.lang);
  const terms = parseSearch(query.search);
  const isSearch = terms.length > 0;

  let scope = null;
  if (id != null) {
    scope = snapshot.reverse.get(id);
    if (scope == null) return null;
  }

  const required = filterSets(snapshot, query);
  const hasFilters = required.length > 0;
  const isFiltered = hasFilters || isSearch || id != null;
  const ignoreParts = id == null && !isSearch;

  // MATCH (iterating byCreated keeps the default order)
  const scores = new Map();
  const objects = [];
  const matchedCreators = [];

  for (const record of snapshot.byCreated) {
    if (record.type !== "object" && record.type !== "creator") continue;
    if (scope && !scope.has(record.id)) continue;
    if (record.type === "object" && ignoreParts && record.isPart) continue;
    if (!required.every((set) => set.has(record.id))) continue;
    if (isSearch) {
      const score = scoreRecord(record, terms);
      if (score === 0) continue;
      scores.set(record.id, score);
    }
    (record.type === "object" ? objects : matchedCreators).push(record);
  }

  // CREATORS of matching objects
  const creatorIds = new Set(matchedCreators.map((record) => record.id));
  const creators = [...matchedCreators];
  for (const object of objects) {
    for (const creatorId of object.links.creator) {
      if (creatorId === id || creatorIds.has(creatorId)) continue;
      const creator = snapshot.records.get(creatorId);
      if (creator?.type !== "creator") continue;
      creatorIds.add(creatorId);
      creators.push(creator);
    }
  }

  // SORT
  const byTitle = (a, b) => a.titleRank[lang] - b.titleRank[lang];
  const byScore = (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);

  if (isSearch) objects.sort(byScore);
  else if (id != null) objects.sort(byTitle);
  creators.sort(isSearch ? (a, b) => byScore(a, b) || byTitle(a, b) : byTitle);

  // PAGINATE
  const list = view === "creator" ? creators : objects;
  const start = (page - 1) * limit;
  const items = list
    .slice(start, start + limit)
    .map((record) =>
      isSearch
        ? { ...record.item, snippets: extractSnippets(record, terms) }
        : record.item,
    );

  return {
    items,
    filters: isFiltered ? facets([...objects, ...creators]) : null,
    hasNextPage: start + limit < list.length,
    total: list.length,
    counts: {
      creators: creators.length,
      objects: objects.length,
    },
  };
}

/**
 * Resolve the filter params of a query to the sets of item ids that have to
 * contain a matching item.
 * @returns {Set<number>[]} sorted by size, smallest first
 */
function filterSets(snapshot, query) {
  const sets = [];
  for (const key of FILTER_KEYS) {
    if (!query[key]) continue;
    const values = [...new Set(String(query[key]).split(","))];
    for (const value of values) {
      const set =
        key === "year"
          ? snapshot.years.get(value)
          : snapshot.linked[key].get(Number(value));
      sets.push(set ?? new Set());
    }
  }
  return sets.sort((a, b) => a.size - b.size);
}

/**
 * Count filter values over matching records.
 * @param {Object[]} records
 * @returns {Object.<string, Object.<string, number>>} e.g. { theme: { 12: 3 }, year: { 1989: 5 } }
 */
function facets(records) {
  const result = Object.fromEntries(FILTER_KEYS.map((key) => [key, {}]));
  const increment = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);

  for (const record of records) {
    for (const name of Object.keys(types)) {
      record.links[name].forEach((linkedId) => increment(result[name], linkedId));
    }
    record.years.forEach((year) => increment(result.year, year));
  }
  return result;
}
