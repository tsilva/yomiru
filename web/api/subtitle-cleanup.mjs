import { database } from "../lib/database.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { applySubtitleCleanup, planSubtitleCleanup } from "../lib/subtitle-cleanup.mjs";
import { authorizedCleanupIdentity } from "../lib/subtitle-cleanup-identity.mjs";

export function createCleanupHandler({ authorize = authorizedCleanupIdentity,
  getDatabase = database, getObjects = createR2Store, environment = process.env } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (environment.VERCEL_ENV !== "production" || request.headers.host !== "yomiru.tsilva.eu"
      || request.method !== "POST") return response.status(404).end();
    try {
      if (!await authorize(request.headers.authorization)) return response.status(401).end();
      const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
      if (!body || !["plan-subtitle-cleanup", "apply-subtitle-cleanup"].includes(body.action)) {
        return response.status(400).end();
      }
      const operation = body.action === "plan-subtitle-cleanup" ? planSubtitleCleanup : applySubtitleCleanup;
      return response.status(200).json(await operation(getDatabase(), getObjects(), body));
    } catch {
      return response.status(409).json({ error: "Subtitle cleanup could not be confirmed" });
    }
  };
}

export default createCleanupHandler();
