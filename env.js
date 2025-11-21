import dotenv from "dotenv";
dotenv.config();
export const {
  REDIS_HOST = "localhost",
  REDIS_PORT = 6379,
  ORIGIN = "/^https?://localhost:[0-9]{1,5}$/",
  OMEKA_API = "https://example.org/omeka/api",
  API_PORT = 3000,
  PAGE_LIMIT = 100,
  PAGE_MAX_LIMIT = 10000,
  FEATURED_ITEM_SET = 4322,
  HEROES_ITEM_SET = 4329,
  NEWSLETTER_TYPE_ID = "4185",
  OMEKA_SITE = "cua",
} = process.env;
