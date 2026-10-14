import cors from "@fastify/cors";
import fastify from "fastify";
import { parseOrigin } from "./utils/helper.js";
import { ORIGIN, API_PORT, API_HOST } from "./env.js";
import { routes } from "./http/routes.js";
import {
  fullSync,
  getSnapshot,
  incrementalSync,
  loadExport,
  scheduleSync,
} from "./store/sync.js";

// ---
// SETUP
// ---

const server = fastify({});
await server.register(cors, {
  origin: parseOrigin(ORIGIN),
});
routes(server);

// ---
// START SERVER
// ---

try {
  // serve the last export right away and catch up in the background,
  // without an export wait for the first full sync
  if (await loadExport()) {
    const hasPages = getSnapshot().pages.size > 0;
    (hasPages ? incrementalSync() : fullSync()).catch(() => {});
  } else {
    await fullSync();
  }
  await server.listen({ host: API_HOST, port: API_PORT });
  scheduleSync();
} catch (err) {
  server.log.error(err);
  console.error(err);
  process.exit(1);
}
