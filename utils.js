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

export function formatItem(item, filters) {
  return {
    id: item["o:id"],
    type: flattenType(item),
    title: flattenProperty(item["dcterms:title"]),
    ...flattenLinkedProperties(item, filters),
    thumbnail: item.thumbnail_display_urls?.medium,
    published: flattenProperty(item["dcterms:date"]),
  };
}

export function formatMedia(media) {
  return {
    filename: media["o:source"],
    url: media["o:original_url"],
    type: media["o:media_type"],
  };
}

export function formatItemDetailed(item, filters) {
  return {
    ...formatItem(item, filters),
    media: item["o:media"]?.map((media) => media["o:id"]),
    titleAlt: flattenProperty(item["dcterms:alternative"]),
    description: flattenProperty(item["dcterms:description"]),
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
