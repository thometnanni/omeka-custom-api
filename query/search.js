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
 * half-width, ligatures), strip diacritics, lowercase.
 * @param {string} str
 * @returns {string}
 */
export function fold(str) {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
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
 * field (AND); each field containing a term adds its weight.
 * @param {{search: Object.<string,string>}} record
 * @param {string[]} terms - folded terms
 * @returns {number} 0 when the record does not match
 */
export function scoreRecord(record, terms) {
  let score = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const field in SEARCH_WEIGHTS) {
      if (record.search[field]?.includes(term)) {
        termScore += SEARCH_WEIGHTS[field];
      }
    }
    if (termScore === 0) return 0;
    score += termScore;
  }
  return score;
}

/**
 * Extract up to 3 text snippets around matches of the search terms in the
 * description and extracted text of a record.
 * @param {{snippetSources: {text:string, folded:string}[]}} record
 * @param {string[]} terms - folded terms
 * @param {number} [max=3]
 * @returns {{term:string, snippet:string}[]}
 */
export function extractSnippets(record, terms, max = 3) {
  const snippets = [];
  for (const source of record.snippetSources) {
    snippets.push(...matchWithContext(source, terms, max - snippets.length));
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
  // the first `max` matches of each term are enough to find the first `max` overall
  const matches = [];
  for (const term of terms) {
    let index = folded.indexOf(term);
    for (let n = 0; index !== -1 && n < max; n++) {
      matches.push({ index, length: term.length });
      index = folded.indexOf(term, index + term.length);
    }
  }
  matches.sort((a, b) => a.index - b.index).splice(max);

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
  // ASCII and CJK ideographs are unchanged by fold()
  if (codePoint < 0x80 || (codePoint >= 0x4e00 && codePoint <= 0x9fff)) return 1;
  let length = foldedLengths.get(codePoint);
  if (length === undefined) {
    length = fold(String.fromCodePoint(codePoint)).length;
    foldedLengths.set(codePoint, length);
  }
  return length;
}
