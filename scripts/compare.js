// Compare the responses of two API instances, e.g. before and after a change.
//
//   node scripts/compare.js http://localhost:3200 http://localhost:3100 [path ...]
//
// Prints the differing JSON paths per request. Arrays of items are compared by
// id, so a different order is reported separately from different content.

const [oldBase, newBase, ...customPaths] = process.argv.slice(2);
if (!oldBase || !newBase) {
  console.error("usage: node scripts/compare.js <old base url> <new base url> [path ...]");
  process.exit(1);
}

const paths = customPaths.length
  ? customPaths
  : [
      "/filters?lang=en",
      "/filters?lang=zh",
      "/ids",
      "/query/?lang=en",
      "/query/?lang=en&page=2",
      "/query/?lang=zh&view=creator",
      "/query/?lang=en&objectType=4185",
      "/query/?lang=en&theme=4223",
      "/query/?lang=en&year=1989",
      "/query/?lang=zh&search=香港",
      "/query/?lang=en&search=hong%20kong",
      "/query/3126?lang=en",
      "/query/607?lang=en",
      "/item/5715?lang=en",
      "/item/3126?lang=zh",
      "/item-details/5715?lang=en",
      "/page/about?lang=en",
      "/page/about?lang=zh",
      "/featured?lang=en",
    ];

const MAX_DIFFS = 8;

for (const path of paths) {
  const [a, b] = await Promise.all([get(oldBase + path), get(newBase + path)]);
  const diffs = [];
  if (a.status !== b.status) diffs.push(`status ${a.status} → ${b.status}`);
  diff(a.body, b.body, "", diffs);
  console.log(`${diffs.length ? "✖" : "✔"} ${path}`);
  diffs.slice(0, MAX_DIFFS).forEach((line) => console.log(`    ${line}`));
  if (diffs.length > MAX_DIFFS) console.log(`    … ${diffs.length - MAX_DIFFS} more`);
}

async function get(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

function diff(a, b, path, out) {
  if (isItemList(a) && isItemList(b)) return diffItemLists(a, b, path, out);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path} length ${a.length} → ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in b)) out.push(`${path}.${key} removed`);
      else if (!(key in a)) out.push(`${path}.${key} added: ${short(b[key])}`);
      else diff(a[key], b[key], `${path}.${key}`, out);
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path} ${short(a)} → ${short(b)}`);
}

function diffItemLists(a, b, path, out) {
  const byId = (list) => new Map(list.map((item) => [item.id, item]));
  const [mapA, mapB] = [byId(a), byId(b)];
  const missing = [...mapA.keys()].filter((id) => !mapB.has(id));
  const added = [...mapB.keys()].filter((id) => !mapA.has(id));
  if (missing.length) out.push(`${path} missing ids: ${missing.slice(0, 20).join(",")}${missing.length > 20 ? ` (+${missing.length - 20})` : ""}`);
  if (added.length) out.push(`${path} added ids: ${added.slice(0, 20).join(",")}${added.length > 20 ? ` (+${added.length - 20})` : ""}`);

  const common = [...mapA.keys()].filter((id) => mapB.has(id));
  const orderB = [...mapB.keys()].filter((id) => mapA.has(id));
  if (common.join() !== orderB.join()) out.push(`${path} different order`);
  for (const id of common) diff(mapA.get(id), mapB.get(id), `${path}[id=${id}]`, out);
}

function isItemList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isObject(item) && "id" in item);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function short(value) {
  const str = JSON.stringify(value) ?? String(value);
  return str.length > 80 ? `${str.slice(0, 77)}…` : str;
}
