// Simulate bot traffic: random filter, page and search combinations.
//
//   node scripts/load.js http://localhost:3100 [seconds=20] [concurrency=50]

const [base, seconds = 20, concurrency = 50] = process.argv.slice(2);
if (!base) {
  console.error("usage: node scripts/load.js <base url> [seconds] [concurrency]");
  process.exit(1);
}

const filters = await fetch(`${base}/filters`).then((res) => res.json());
const ids = await fetch(`${base}/ids`).then((res) => res.json()).then(Object.keys);
const words = ["hong kong", "香港", "工人", "lin zhao", "林昭", "1989", "workers", "protest", "abc", "zzzz"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function randomPath() {
  const r = Math.random();
  if (r < 0.15) return `/item/${pick(ids)}?lang=${pick(["en", "zh", "zh-hk"])}`;
  if (r < 0.2) return `/item/${Math.floor(Math.random() * 1e6)}`;
  const params = new URLSearchParams({ lang: pick(["en", "zh", "zh-hk"]) });
  for (const key of ["objectType", "theme", "era", "creator"]) {
    if (Math.random() < 0.3) params.set(key, pick(filters[key]).id);
  }
  if (Math.random() < 0.3) params.set("year", pick(filters.year).value);
  if (Math.random() < 0.3) params.set("search", pick(words) + (Math.random() < 0.5 ? `${Math.random()}`.slice(2, 4) : ""));
  if (Math.random() < 0.3) params.set("page", 1 + Math.floor(Math.random() * 5));
  if (Math.random() < 0.3) params.set("view", "creator");
  if (Math.random() < 0.2) params.set("_", Math.random());
  return `/query/?${params}`;
}

const before = await fetch(`${base}/status`).then((res) => res.json());
const latencies = [];
const statuses = {};
const end = Date.now() + seconds * 1000;

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (Date.now() < end) {
      const start = performance.now();
      const res = await fetch(base + randomPath());
      await res.arrayBuffer();
      latencies.push(performance.now() - start);
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
    }
  }),
);

const after = await fetch(`${base}/status`).then((res) => res.json());
latencies.sort((a, b) => a - b);
const p = (q) => latencies[Math.floor(latencies.length * q)].toFixed(1);
console.log({
  requests: latencies.length,
  perSecond: Math.round(latencies.length / seconds),
  statuses,
  p50: p(0.5),
  p95: p(0.95),
  p99: p(0.99),
  max: latencies.at(-1).toFixed(1),
  omekaRequests: after.omekaRequests - before.omekaRequests,
  heapMB: `${before.heapMB} → ${after.heapMB}`,
});
