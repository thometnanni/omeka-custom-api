import { filterConfig } from "../types.js";

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

  const page = query?.page?.trim() ?? 1;
  queryStrings.push(`page=${encodeURIComponent(page)}`);

  return queryStrings.join("&");
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
function filterQuery(property, value, index = 0, type = "res") {
  return `property[${index}][property]=${property}&property[${index}][type]=${type}&property[${index}][text]=${value}`;
}
