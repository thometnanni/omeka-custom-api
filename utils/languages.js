/**
 * Single source of truth for supported languages.
 * FALLBACKS lists the codes to try (in order) before DEFAULT_LANGUAGE.
 */
export const DEFAULT_LANGUAGE = "en";

export const SUPPORTED_LANGUAGES = ["en", "zh", "zh-hk"];

export const FALLBACKS = {
  en: [],
  zh: ["zh-hk"],
  "zh-hk": ["zh"],
};

export const COLLATORS = {
  en: new Intl.Collator("en", { sensitivity: "base", numeric: true }),
  zh: new Intl.Collator("zh-Hans-u-co-pinyin", {
    sensitivity: "base",
    numeric: true,
  }),
  "zh-hk": new Intl.Collator("zh-Hant-HK-u-co-stroke", {
    sensitivity: "base",
    numeric: true,
  }),
};

/**
 * Map a requested language onto a supported code.
 * Accepts casing/underscore variants ("zh_HK" -> "zh-hk") and falls back to
 * the base language ("zh-tw" -> "zh"). Unknown input yields DEFAULT_LANGUAGE.
 * @param {*} lang
 * @returns {string}
 */
export function normalizeLang(lang) {
  if (typeof lang !== "string") return DEFAULT_LANGUAGE;

  const code = lang.trim().toLowerCase().replace("_", "-");
  if (SUPPORTED_LANGUAGES.includes(code)) return code;

  const base = code.split("-")[0];
  if (SUPPORTED_LANGUAGES.includes(base)) return base;

  return DEFAULT_LANGUAGE;
}
