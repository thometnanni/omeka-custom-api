import {
  DEFAULT_LANGUAGE,
  FALLBACKS,
  SUPPORTED_LANGUAGES,
  normalizeLang,
} from "./languages.js";
import { convertTo } from "./chinese.js";

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
 *   the value for lang, then its FALLBACKS (converted to the script of lang),
 *   then the default language.
 * - Untagged strings are converted to the script of a Chinese lang.
 * - Otherwise traverse the object/array and localize nested values.
 * @param {*} obj
 * @param {string|null} lang
 * @returns {*}
 */

export function localizeObject(obj, lang) {
  if (lang == null) return obj;
  return localize(obj, normalizeLang(lang));
}

function localize(obj, lang) {
  if (typeof obj === "string") return convertTo(obj, lang, { request: true });
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && keys.every(isLanguageKey)) {
    return pickLanguage(obj, lang) || obj;
  }

  return Object.entries(obj).reduce(
    (result, [key, value]) => {
      result[key] = localize(value, lang);
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

  if (byCode[lang]) return byCode[lang];
  // maps built at request time (e.g. snippets) are not completed on sync
  const fallback = FALLBACKS[lang].find((code) => byCode[code]);
  if (fallback) return convertTo(byCode[fallback], lang, { request: true });
  if (byCode[DEFAULT_LANGUAGE]) return byCode[DEFAULT_LANGUAGE];

  return Object.values(obj).find(Boolean);
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
