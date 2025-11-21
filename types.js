/**
 * Mapping of domain keys to their RDF term and raw item property.
 * @type {Object.<string, {term:string, property:string}>}
 */
export const types = {
  creator: {
    term: "foaf:Person",
    property: "dcterms:creator",
  },
  objectType: {
    term: "skos:Concept",
    property: "curation:category",
  },
  theme: {
    term: "dctype:Collection",
    property: "curation:theme",
  },
  era: { term: "dctype:Event", property: "dcterms:coverage" },
};

/**
 * Filter configuration used to build query strings. Extends `types`.
 * year includes a searchType override.
 */

export const filterConfig = {
  ...types,
  year: { property: "dcterms:date", searchType: "sw" },
};
