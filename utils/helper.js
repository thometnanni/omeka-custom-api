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
 * Return a new object that contains only the entries whose value is
 * neither null nor undefined.
 *
 * @param {Object} obj – the source object
 * @returns {Object} a copy without null/undefined values
 */

export function omitNullish(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== null && value !== undefined
    )
  );
}
