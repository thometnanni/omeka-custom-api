import { OMEKA_API } from "../env.js";

const TIMEOUT = 1000 * 30;

let requestCount = 0;

/**
 * Number of requests sent to Omeka since startup.
 * @returns {number}
 */
export function omekaRequestCount() {
  return requestCount;
}

/**
 * GET a path from the Omeka API.
 * @param {string} path - e.g. "/items?page=1"
 * @returns {Promise<{data: *, total: number|null}>} parsed body and the
 *   Omeka-S-Total-Results header (null when absent)
 */
export async function omekaGet(path) {
  requestCount++;
  const res = await fetch(`${OMEKA_API}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    throw new Error(`Omeka request failed: ${res.status} ${path}`);
  }
  const total = res.headers.get("omeka-s-total-results");
  return { data: await res.json(), total: total == null ? null : +total };
}

/**
 * Fetch every page of a resource list.
 * @param {string} resource - e.g. "items"
 * @param {Object} [params] - extra query params
 * @param {number} [perPage=100]
 * @returns {Promise<Object[]>}
 */
export async function omekaGetAll(resource, params = {}, perPage = 100) {
  const all = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      sort_by: "id",
      sort_order: "asc",
      ...params,
      per_page: perPage,
      page,
    });
    const { data } = await omekaGet(`/${resource}?${query}`);
    all.push(...data);
    if (data.length < perPage) return all;
    // be gentle with the Omeka server
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
