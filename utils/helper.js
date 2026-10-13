import {
  DEFAULT_LANGUAGE,
  FALLBACKS,
  SUPPORTED_LANGUAGES,
  normalizeLang,
} from "./languages.js";

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
 * - If obj is a language-keyed map (every key is a supported language) return
 *   the value for lang, then its FALLBACKS, then the default language.
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

  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.every(isLanguageKey)) {
    return pickLanguage(obj, normalizeLang(lang)) || obj;
  }

  return Object.entries(obj).reduce(
    (result, [key, value]) => {
      result[key] = localizeObject(value, lang);
      return result;
    },
    Array.isArray(obj) ? [] : {}
  );
}

function isLanguageKey(key) {
  return SUPPORTED_LANGUAGES.includes(key.toLowerCase());
}

function pickLanguage(obj, lang) {
  const byCode = Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key.toLowerCase(), value])
  );

  const candidates = [lang, ...FALLBACKS[lang], DEFAULT_LANGUAGE];
  const match = candidates.find((code) => byCode[code]);

  return match ? byCode[match] : Object.values(obj).find(Boolean);
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
