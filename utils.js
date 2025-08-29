export function parseOrigin(origin) {
  return origin
    .match(/(?:\/.*?\/|[^,])+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((str) => new RegExp(str.replace(/^\//, "").replace(/\/$/, "")));
}

export function makeCacheKey(req) {
  const base = req.originalUrl;
  const body = req.method === "GET" ? "" : JSON.stringify(req.body);
  return `${req.method}:${base}:${Buffer.from(body).toString("base64")}`;
}
