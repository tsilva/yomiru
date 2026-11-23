import { database } from "../lib/database.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { createIncrementalStore } from "../lib/incremental-publication.mjs";
import { authorizedGzipMigrationIdentity } from "../lib/subtitle-cleanup-identity.mjs";
import { activateGzipTracks, gzipMigrationReceipt, pruneMigratedGzipTracks,
  stageGzipTracks } from "../lib/subtitle-gzip-migration.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (process.env.VERCEL_ENV !== "production" || request.headers.host !== "yomiru.tsilva.eu"
    || request.method !== "POST") return response.status(404).end();
  try {
    if (!await authorizedGzipMigrationIdentity(request.headers.authorization)) return response.status(401).end();
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    switch (body?.action) {
      case "status":
        return response.status(200).json(await createIncrementalStore(database()).state());
      case "stage":
        return response.status(200).json(await stageGzipTracks(database(), createR2Store(), body));
      case "activate":
        return response.status(200).json(await activateGzipTracks(database(), createR2Store(), body));
      case "receipt":
        return response.status(200).json(await gzipMigrationReceipt(database(), body));
      case "prune":
        return response.status(200).json(await pruneMigratedGzipTracks(database(), createR2Store(), body));
      default:
        return response.status(400).end();
    }
  } catch {
    return response.status(409).json({ error: "The gzip migration could not be confirmed" });
  }
}
