/**
 * Extract text snippets around matches of the search terms in the text.
 *
 * @param {string} item
 * @param {string} search - search term
 * @returns {{term:string, snippet:string}[]}
 */

export function extractSnippets(item, search) {
  const regex = searchToRegex(search);

  const snippets = [
    ...matchWithContext(item.description, regex),
    ...matchWithContext(item.text, regex),
  ];

  return snippets.slice(0, 3);
}
/**
 * Converts a search string into a regular expression
 *
 * @param {string} str – The search term
 * @returns {RegExp}   – The converted regex
 */
function searchToRegex(str) {
  // Match either a quoted part ("…") or a run of non‑space chars.
  const tokenRegex = /"([^"]*)"|(\S+)/g;

  const matches = str.match(tokenRegex);
  const terms = matches.map((match) =>
    match
      // remove quotation marks
      .replace(/"/g, "")
      // escape regex characters
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );

  const regex = new RegExp(terms.join("|"), "gi");
  return regex;
}
/**
 * matches text against regex and returns results with context
 *
 * @param {string} text – The search term to split
 * @param {string} regex – The regex to match against
 * @param {number} [context=60] – Number of characters to include before and after each match. Defualts to 60.
 *
 * @returns {{term:string, snippet:string}[]} – An array of objects where:
 *   • **term** – the exact substring that matched the regex.
 *   • **snippet** – a trimmed excerpt of the original text including match with context
 */
function matchWithContext(text, regex, context = 60) {
  const result = [];
  let match;
  while ((match = regex.exec(text)) != null) {
    const term = match[0];

    const start = Math.max(0, match.index - context);
    const stop = Math.min(text.length, match.index + term.length + context);
    const sliced = text.slice(start, stop).trim();

    const snippet = `${start > 0 ? "…" : ""}${sliced}${
      stop < text.length ? "…" : ""
    }`;
    result.push({ term, snippet });
  }
  return result;
}
