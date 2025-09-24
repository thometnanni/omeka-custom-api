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

export function flattenProperty(property) {
  if (Array.isArray(property) && property.length > 1) {
    return Object.fromEntries(
      property.map((p) => [p["@language"], p["@value"].trim?.()] ?? p["@value"])
    );
  }
  const value = property?.[0]?.["@value"] ?? property?.["@value"] ?? property;
  return value?.trim?.() ?? value;
}

export function flattenLinkedProperties(item, types, filters) {
  return Object.fromEntries(
    Object.entries(types).map(([name, type]) => {
      const values = item[type.property]?.map(({ value_resource_id }) => {
        const { title, id } =
          filters[name]?.find(({ id }) => id === value_resource_id) ?? {};
        return {
          title,
          id,
        };
      });
      return [name, values];
    })
  );
}

export function flattenType(item, types) {
  const term = [item["@type"]]?.flat()?.find((type) =>
    Object.values(types)
      .map(({ term }) => term)
      .includes(type)
  );

  const type = Object.entries(types).find(
    ([, type]) => type.term === term
  )?.[0];

  return type ?? "object";
}

export function localizeObject(obj, lang) {
  if (lang == null) return obj;
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Object.keys(obj).every((key) => key.length === 2)) {
    return obj[lang] || obj[Object.keys(obj)[0]] || obj;
  }

  return Object.entries(obj).reduce(
    (result, [key, value]) => {
      result[key] = localizeObject(value, lang);
      return result;
    },
    Array.isArray(obj) ? [] : {}
  );
}

export function filterQuery(property, value, index = 0, type = "res") {
  return `property[${index}][property]=${property}&property[${index}][type]=${type}&property[${index}][text]=${value}`;
}
