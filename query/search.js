import { foldScript } from "../utils/chinese.js";

/**
 * Search fields and their weight in the relevance score.
 * The haystacks themselves are built once per item in store/snapshot.js.
 */
export const SEARCH_WEIGHTS = {
  title: 5,
  number: 4,
  linked: 3,
  description: 2,
  other: 1,
  text: 1,
};

/**
 * Fold a string for matching: compatibility decomposition (full-width →
 * half-width, ligatures), strip diacritics, lowercase, traditional → simplified
 * Chinese characters.
 * @param {string} str
 * @returns {string}
 */
export function fold(str) {
  if (!str) return "";
  return foldScript(
    str
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase(),
  );
}

/**
 * Takes a string of comma separated search terms and returns the folded terms
 * that are at least 3 characters long or contain Chinese characters.
 * @param {string} [search]
 * @returns {string[]}
 */
export function parseSearch(search) {
  if (typeof search !== "string") return [];
  const terms = search
    .split(",")
    .map((term) => fold(term.replace(/"/g, "").trim()))
    .filter((term) => term.length >= 3 || /\p{Script=Han}/u.test(term));
  return [...new Set(terms)].sort();
}

/**
 * Score a record against all terms. Every term has to occur in at least one
 * field (AND); each field containing a term adds its weight times the match
 * quality (whole word > word start > substring).
 * @param {{search: Object.<string,string>}} record
 * @param {string[]} terms - folded terms
 * @returns {number} 0 when the record does not match
 */
export function scoreRecord(record, terms) {
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const field in SEARCH_WEIGHTS) {
      termScore += SEARCH_WEIGHTS[field] * matchQuality(record.search[field], term);
    }
    if (termScore === 0) return 0;
    score += termScore;
  }
  return score;
}

// factors of the match qualities
const WORD = 1;
const PREFIX = 0.5;
const SUBSTRING = 0.2;

/**
 * Best match quality of a term in a text: WORD if it occurs as a whole word,
 * PREFIX if at the start of a word, SUBSTRING otherwise, 0 if not at all.
 * Checks at most `limit` occurrences.
 * @param {string} [text] - folded text
 * @param {string} term - folded term
 * @param {number} [limit=100]
 * @returns {number}
 */
export function matchQuality(text, term, limit = 100) {
  if (!text) return 0;
  let best = 0;
  let index = text.indexOf(term);
  for (let n = 0; index !== -1 && n < limit; n++) {
    best = Math.max(best, qualityAt(text, index, term.length));
    if (best === WORD) break;
    index = text.indexOf(term, index + 1);
  }
  return best;
}

/**
 * Match quality of an occurrence of a term in a text.
 * @param {string} text
 * @param {number} index - start of the occurrence
 * @param {number} length - length of the term
 * @returns {number}
 */
function qualityAt(text, index, length) {
  const before =
    isBoundary(text, index - 1) || isHan(text, index); // first char of the term
  if (!before) return SUBSTRING;
  const after =
    isBoundary(text, index + length) || isHan(text, index + length - 1); // last char
  return after ? WORD : PREFIX;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const HAN_CHAR = /\p{Script=Han}/u;

// Chinese has no spaces between words, so Han characters count as boundaries
function isBoundary(text, index) {
  if (index < 0 || index >= text.length) return true;
  const char = charAt(text, index);
  return !WORD_CHAR.test(char) || HAN_CHAR.test(char);
}

function isHan(text, index) {
  return HAN_CHAR.test(charAt(text, index));
}

// the code point at a UTF-16 index, also if it points to the low surrogate
function charAt(text, index) {
  const code = text.charCodeAt(index);
  if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
    return String.fromCodePoint(text.codePointAt(index - 1));
  }
  return String.fromCodePoint(text.codePointAt(index));
}

/**
 * Extract up to 3 text snippets around matches of the search terms in the
 * description and extracted text of a record. Snippets of tagged texts are
 * language maps, e.g. { term: { zh: "…" }, snippet: { zh: "…" } }, so
 * localization keeps them as written for their own language.
 * @param {{snippetSources: {text:string, folded:string, lang?:string}[]}} record
 * @param {string[]} terms - folded terms
 * @param {number} [max=3]
 * @returns {{term:string|Object, snippet:string|Object}[]}
 */
export function extractSnippets(record, terms, max = 3) {
  const snippets = [];
  for (const source of record.snippetSources) {
    const matches = matchWithContext(source, terms, max - snippets.length);
    snippets.push(
      ...(source.lang
        ? matches.map(({ term, snippet }) => ({
            term: { [source.lang]: term },
            snippet: { [source.lang]: snippet },
          }))
        : matches),
    );
    if (snippets.length >= max) break;
  }
  return snippets;
}

/**
 * Find terms in the folded text and return the original text around them.
 * @param {{text:string, folded:string}} source - text and fold(text)
 * @param {string[]} terms - folded terms
 * @param {number} max - maximum number of snippets
 * @param {number} [context=60] - characters before and after each match
 * @returns {{term:string, snippet:string}[]}
 */
function matchWithContext({ text, folded }, terms, max, context = 60) {
  // collect several occurrences per term, then prefer whole words, then position
  const matches = [];
  for (const term of terms) {
    let index = folded.indexOf(term);
    for (let n = 0; index !== -1 && n < 20; n++) {
      const quality = qualityAt(folded, index, term.length);
      matches.push({ index, length: term.length, quality });
      index = folded.indexOf(term, index + term.length);
    }
  }
  matches.sort((a, b) => b.quality - a.quality || a.index - b.index).splice(max);

  // folding rarely changes the length; only map indices when it does
  const original =
    folded.length === text.length
      ? (indices) => indices
      : (indices) => originalIndices(text, indices);

  return matches.map(({ index, length }) => {
    const [matchStart, matchStop] = original([index, index + length]);
    const start = Math.max(0, matchStart - context);
    const stop = Math.min(text.length, matchStop + context);

    return {
      term: text.slice(matchStart, matchStop),
      snippet: `${start > 0 ? "…" : ""}${text.slice(start, stop).trim()}${
        stop < text.length ? "…" : ""
      }`,
    };
  });
}

/**
 * Map indices of fold(text) back to indices of text, walking the text only
 * up to the last index.
 * @param {string} text
 * @param {number[]} indices - ascending indices into fold(text)
 * @returns {number[]}
 */
function originalIndices(text, indices) {
  const result = [];
  let i = 0; // index in text
  let f = 0; // index in fold(text)

  for (const target of indices) {
    while (i < text.length) {
      const codePoint = text.codePointAt(i);
      const length = foldedLength(codePoint);
      if (f + length > target) break;
      f += length;
      i += codePoint > 0xffff ? 2 : 1;
    }
    result.push(i);
  }
  return result;
}

const foldedLengths = new Map();

function foldedLength(codePoint) {
  // ASCII and CJK ideographs keep their length in fold()
  if (codePoint < 0x80 || (codePoint >= 0x4e00 && codePoint <= 0x9fff)) return 1;
  let length = foldedLengths.get(codePoint);
  if (length === undefined) {
    length = fold(String.fromCodePoint(codePoint)).length;
    foldedLengths.set(codePoint, length);
  }
  return length;
}
