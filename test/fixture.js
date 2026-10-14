// Minimal raw Omeka items, shaped like responses of /api/items

const literal = (value, language) => ({
  type: "literal",
  "@value": value,
  ...(language && { "@language": language }),
});
const link = (id, title = "") => ({
  type: "resource",
  value_resource_id: id,
  value_resource_name: "items",
  display_title: title,
});
// timestamps n minutes after 2025-01-01
const time = (n) => ({
  "@value": new Date(Date.UTC(2025, 0, 1, 0, n)).toISOString().replace(".000Z", "+00:00"),
});

export function rawItem({
  id,
  type,
  title,
  created = id,
  modified = created,
  date,
  description,
  text,
  creator = [],
  objectType = [],
  theme = [],
  partOf,
  itemSets = [],
}) {
  const titles =
    typeof title === "string"
      ? [literal(title)]
      : Object.entries(title).map(([lang, value]) => literal(value, lang));
  return {
    "o:id": id,
    "@type": type ? ["o:Item", type] : "o:Item",
    "o:created": time(created),
    "o:modified": time(modified),
    "o:item_set": itemSets.map((set) => ({ "o:id": set })),
    "o:media": [],
    thumbnail_display_urls: { medium: `https://files/${id}.jpg`, large: `https://files/${id}-l.jpg` },
    "dcterms:title": titles,
    ...(date && { "dcterms:date": [date].flat().map((d) => literal(d)) }),
    ...(description && { "dcterms:description": [literal(description)] }),
    ...(text && { "extracttext:extracted_text": [literal(text)] }),
    ...(creator.length && { "dcterms:creator": creator.map((c) => link(c)) }),
    ...(objectType.length && { "curation:category": objectType.map((c) => link(c)) }),
    ...(theme.length && { "curation:theme": theme.map((c) => link(c)) }),
    ...(partOf && { "dcterms:isPartOf": [link(partOf)] }),
  };
}

export const CREATOR_A = 1;
export const CREATOR_B = 2;
export const CREATOR_UNUSED = 3;
export const TYPE_BOOK = 10;
export const TYPE_NEWSLETTER = 11;
export const THEME_LABOR = 20;
export const PERIODICAL = 30;

export const items = [
  rawItem({ id: CREATOR_A, type: "foaf:Person", title: { en: "Alice Zhang", zh: "张爱丽" } }),
  rawItem({ id: CREATOR_B, type: "foaf:Person", title: "Bob Wang", description: "Writes about café culture" }),
  rawItem({ id: CREATOR_UNUSED, type: "foaf:Person", title: "Carol Unused" }),
  rawItem({ id: TYPE_BOOK, type: "skos:Concept", title: "Book" }),
  rawItem({ id: TYPE_NEWSLETTER, type: "skos:Concept", title: "Newsletter" }),
  rawItem({ id: THEME_LABOR, type: "dctype:Collection", title: "Labor" }),
  rawItem({ id: PERIODICAL, title: "A Periodical", objectType: [TYPE_NEWSLETTER], created: 30 }),
  rawItem({
    id: 31,
    type: "bibo:Issue",
    title: "Issue 1",
    partOf: PERIODICAL,
    text: "Workers in Hong Kong…",
    created: 31,
  }),
  rawItem({
    id: 40,
    title: "Zebra book about Hong Kong",
    creator: [CREATOR_A],
    objectType: [TYPE_BOOK],
    theme: [THEME_LABOR],
    date: "1989-06-04",
    created: 40,
    itemSets: [100],
  }),
  rawItem({
    id: 41,
    title: "Apple book",
    creator: [CREATOR_A, CREATOR_B],
    objectType: [TYPE_BOOK],
    date: ["1990", "1989"],
    text: "A long text … mentioning hong kong once and ＣＡＦＥ in full width.",
    created: 41,
    itemSets: [100, 200],
  }),
  rawItem({
    id: 42,
    title: "Newsletter 3",
    creator: [CREATOR_B],
    objectType: [TYPE_NEWSLETTER],
    theme: [THEME_LABOR],
    date: "1990",
    created: 42,
  }),
];
