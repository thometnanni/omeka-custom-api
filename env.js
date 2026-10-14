import dotenv from "dotenv";
dotenv.config();
const env = {
  ORIGIN: "/^https?://localhost:[0-9]{1,5}$/",
  OMEKA_API: "https://example.org/omeka/api",
  API_PORT: 3000,
  API_HOST: "0.0.0.0",
  PAGE_LIMIT: 100,
  PAGE_MAX_LIMIT: 200,
  FEATURED_ITEM_SET: 4322,
  HEROES_ITEM_SET: 4329,
  NEWSLETTER_TYPE_ID: 4185,
  OMEKA_SITE: "cua",
  OMEKA_FILE_URL_REPLACEMENT: "", // = "https://cua-files.git-87a.workers.dev",
  OMEKA_FILE_URL: "", // = "https://minjian-danganguan.org/files",
  EXPORT_PATH: "./export.json",
  FLUSH_SECRET: "",
  SYNC_INTERVAL: 60, // seconds between incremental syncs
  FULL_SYNC_INTERVAL: 60 * 60 * 6, // seconds between full syncs
  RESPONSE_CACHE_MB: 64,
  MEDIA_CACHE_MB: 64,
  ...process.env,
};

const numeric = [
  "API_PORT",
  "PAGE_LIMIT",
  "PAGE_MAX_LIMIT",
  "FEATURED_ITEM_SET",
  "HEROES_ITEM_SET",
  "NEWSLETTER_TYPE_ID",
  "SYNC_INTERVAL",
  "FULL_SYNC_INTERVAL",
  "RESPONSE_CACHE_MB",
  "MEDIA_CACHE_MB",
];
for (const key of numeric) env[key] = Number(env[key]);

export const {
  ORIGIN,
  OMEKA_API,
  API_PORT,
  API_HOST,
  PAGE_LIMIT,
  PAGE_MAX_LIMIT,
  FEATURED_ITEM_SET,
  HEROES_ITEM_SET,
  NEWSLETTER_TYPE_ID,
  OMEKA_SITE,
  OMEKA_FILE_URL_REPLACEMENT,
  OMEKA_FILE_URL,
  EXPORT_PATH,
  FLUSH_SECRET,
  SYNC_INTERVAL,
  FULL_SYNC_INTERVAL,
  RESPONSE_CACHE_MB,
  MEDIA_CACHE_MB,
} = env;
