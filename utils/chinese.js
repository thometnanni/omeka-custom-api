import OpenCC from "opencc-js";
import HKVariantsRev from "opencc-js/dict/HKVariantsRev";
import TSCharacters from "opencc-js/dict/TSCharacters";
import { LRU } from "./lru.js";
import { SCRIPT_CACHE_MB } from "../env.js";

const HAN = /\p{Script=Han}/u;

/**
 * @param {*} str
 * @returns {boolean} whether str is a string containing Han characters
 */
export function hasHan(str) {
  return typeof str === "string" && HAN.test(str);
}

// s2hkp and hk2sp: character and phrase conversion
const s2hkp = OpenCC.Converter({ from: "cn", to: "hkp" });
const hk2sp = OpenCC.Converter({ from: "hkp", to: "cn" });

// Mainland texts quote with “” and nest with ‘’, Hong Kong texts use 「」 and 『』.
// Straight quotes are left alone, they also delimit html attributes.
const CORNER_QUOTES = { "“": "「", "”": "」", "‘": "『", "’": "』" };
const CURLY_QUOTES = Object.fromEntries(
  Object.entries(CORNER_QUOTES).map(([curly, corner]) => [corner, curly]),
);
const LATIN = /\p{Script=Latin}/u;

function toCornerQuotes(str) {
  return str.replace(/[“”‘’]/g, (char, index) =>
    // keep apostrophes in latin words, e.g. Mao’s
    char === "’" && LATIN.test(str[index - 1] ?? "") && LATIN.test(str[index + 1] ?? "")
      ? char
      : CORNER_QUOTES[char],
  );
}

function toCurlyQuotes(str) {
  return str.replace(/[「」『』]/g, (char) => CURLY_QUOTES[char]);
}

const converters = {
  "zh-hk": (str) => toCornerQuotes(s2hkp(str)),
  zh: (str) => toCurlyQuotes(hk2sp(str)),
};

const sizeOf = (str) => str.length;
// conversions of snapshot values, sized far above the working set so unchanged
// text is never converted again on rebuilds
const syncCache = new LRU(SCRIPT_CACHE_MB * 1024 * 1024, sizeOf);
// conversions of snippets and untagged strings at request time
const requestCache = new LRU(16 * 1024 * 1024, sizeOf);

/**
 * Whether a language has a counterpart in the other Chinese script.
 * @param {string} lang
 * @returns {boolean}
 */
export function isChinese(lang) {
  return lang in converters;
}

/**
 * Convert text to the script of a Chinese language: "zh" (simplified) or
 * "zh-hk" (traditional, Hong Kong). Text without Han characters and other
 * languages are returned unchanged.
 * @param {*} str
 * @param {string} lang
 * @param {{request?: boolean}} [options] - request: use the request cache
 * @returns {*}
 */
export function convertTo(str, lang, { request = false } = {}) {
  if (!isChinese(lang) || !hasHan(str)) return str;

  const cache = request ? requestCache : syncCache;
  const key = `${lang}:${str}`;
  let converted = cache.get(key);
  if (converted === undefined) {
    converted = cache.set(key, converters[lang](str));
  }
  return converted;
}

// Character-only traditional → simplified mapping for search. Unlike the
// phrase converters it never changes the length of a string, so match
// positions can be mapped back to the original text.
const foldMap = new Map();
const singleChars = (dict) =>
  dict
    .split("|")
    .map((entry) => entry.split(" "))
    .filter(([from, to]) => [...from].length === 1 && to)
    .map(([from, to]) => [from, [...to][0]]);

const traditionalToSimplified = new Map(singleChars(TSCharacters));
for (const [variant, traditional] of singleChars(HKVariantsRev)) {
  foldMap.set(variant, traditionalToSimplified.get(traditional) ?? traditional);
}
for (const [traditional, simplified] of traditionalToSimplified) {
  if (!foldMap.has(traditional)) foldMap.set(traditional, simplified);
}
// a few rare characters map between BMP and astral planes; skip them to keep lengths
for (const [from, to] of foldMap) {
  if (from.length !== to.length) foldMap.delete(from);
}
const foldPattern = new RegExp(
  `[${[...foldMap.keys()].join("").replace(/[\]\\^-]/g, "\\$&")}]`,
  "gu",
);

/**
 * Map traditional characters to simplified ones, character by character.
 * @param {string} str
 * @returns {string}
 */
export function foldScript(str) {
  return str.replace(foldPattern, (char) => foldMap.get(char));
}
