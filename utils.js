import he from "he";

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

export const filterConfig = {
  ...types,
  year: { property: "dcterms:date", searchType: "sw" },
};

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

export function flattenLinkedProperties(item, filters) {
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

export function flattenType(item) {
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

export function parseQuery(query, offset = 0) {
  const filters = {
    objectType: (query?.objectType?.split(",") ?? []).sort(),
    creator: (query?.creator?.split(",") ?? []).sort(),
    theme: (query?.theme?.split(",") ?? []).sort(),
    era: (query?.era?.split(",") ?? []).sort(),
    year: (query?.year?.split(",") ?? []).sort(),
  };

  const queryStrings = Object.entries(filters)
    .map(([type, values]) =>
      values.map((value) => {
        return {
          property: filterConfig[type].property,
          searchType: filterConfig[type].searchType,
          value,
        };
      })
    )
    .flat()
    .map(({ property, value, searchType }, i) =>
      filterQuery(property, value, offset + i, searchType)
    );

  const search = query?.search?.trim();

  if (search) {
    queryStrings.push(`fulltext_search=${encodeURIComponent(search)}`);
  }
  return queryStrings.join("&");
}

export function formatItem(raw, filters, search = null) {
  const title = flattenProperty(raw["dcterms:title"]);
  const description = flattenProperty(raw["dcterms:description"]);
  const titleAlt = flattenProperty(raw["dcterms:alternative"]);
  const published = flattenProperty(raw["dcterms:date"]);
  const blob = [
    textOf(title),
    textOf(description),
    textOf(titleAlt),
    linkedTitles(raw, filters),
  ]
    .filter(Boolean)
    .join(" ");
  const hits = search ? extractSnippets(blob, search, 3, 80) : [];
  const snippets = hits.length
    ? Array.from(new Set(hits)).slice(0, 3)
    : undefined;
  return {
    id: raw["o:id"],
    type: flattenType(raw),
    title,
    ...flattenLinkedProperties(raw, filters),
    thumbnail: raw.thumbnail_display_urls?.medium,
    published,
    ...(snippets ? { snippets } : {}),
  };
}

export function formatMedia(media) {
  const rawHtml = media?.data?.html ?? media?.["o-cnt:chars"];
  const html = rawHtml ? he.decode(rawHtml) : null;
  const text = html ? htmlToPlainText(html) : null;
  const rawLang =
    media?.["o:lang"] ??
    media?.["o:language"] ??
    media?.["dcterms:language"]?.[0]?.["@value"];
  const lang =
    typeof rawLang === "string" && rawLang.length ? rawLang : null;
  return {
    filename: media["o:source"],
    url: media["o:original_url"],
    type: media["o:media_type"],
    ...(lang ? { lang } : {}),
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
  };
}

export function formatItemDetailed(raw, filters, search = null) {
  const base = formatItem(raw, filters, search);
  return {
    ...base,
    media: raw["o:media"]?.map((m) => m["o:id"]),
    titleAlt: flattenProperty(raw["dcterms:alternative"]),
    description: flattenProperty(raw["dcterms:description"]),
  };
}

export function formatItemFilters(items, filters) {
  const itemFilters = Object.fromEntries(
    Object.keys(filterConfig).map((key) => [key, {}])
  );
  items.forEach((item) => {
    Object.keys(filterConfig).forEach((key) => {
      if (!item[key]) return;
      item[key].forEach((filter) => {
        const filterKey = filter.id ?? filter.value;

        itemFilters[key][filterKey] = itemFilters[key][filterKey]
          ? itemFilters[key][filterKey] + 1
          : 1;
      });

      itemFilters.year[item.published] = itemFilters.year[item.published]
        ? itemFilters.year[item.published] + 1
        : 1;
    });
  });
  return itemFilters;
}

export function textOf(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(" ");
  if (typeof v === "object")
    return Object.values(v).map(textOf).filter(Boolean).join(" ");
  return String(v);
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSnippets(text, query, maxSnippets = 3, context = 80) {
  if (!text || !query) return [];
  const terms = Array.from(
    new Set(String(query).trim().split(/\s+/).filter(Boolean))
  );
  if (!terms.length) return [];
  const re = new RegExp(terms.map(escapeRegex).join("|"), "gi");
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < maxSnippets) {
    const a = Math.max(0, m.index - context);
    const b = Math.min(text.length, m.index + m[0].length + context);
    out.push(
      (a > 0 ? "…" : "") + text.slice(a, b) + (b < text.length ? "…" : "")
    );
  }
  return out;
}

export function linkedTitles(raw, filters) {
  const out = [];
  Object.entries(types).forEach(([name, type]) => {
    const vals = raw[type.property] || [];
    vals.forEach((v) => {
      const id = v?.value_resource_id;
      const m = filters[name]?.find((x) => x.id === id);
      const t = m?.title || v?.display_title || v?.["o:label"];
      if (t) out.push(String(t));
    });
  });
  return out.join(" ");
}

function htmlToPlainText(html) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
