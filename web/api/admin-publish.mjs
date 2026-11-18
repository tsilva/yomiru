import { head, put, BlobNotFoundError } from "@vercel/blob";
import { protectedAdminHost, writePublicationObject } from "../lib/admin-publication.mjs";
import { createR2Store } from "../lib/r2.mjs";
import { publicationStore } from "../lib/database.mjs";
import { databaseEnabled, r2Origin } from "../lib/storage-config.mjs";
import { activateR2Publication, readBlobPublication } from "../lib/r2-publication.mjs";
import { importBlobPage } from "../lib/import-blob.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const r2 = databaseEnabled();
  if (!protectedAdminHost(request, process.env, r2)) return response.status(404).end();
  if (request.method !== "POST" && !(r2 && request.method === "GET")) {
    response.setHeader("Allow", r2 ? "GET, POST" : "POST");
    return response.status(405).end();
  }
  try {
    if (r2 && request.method === "GET") {
      const revision = await publicationStore().current();
      return response.status(200).json({ origin: r2Origin(), revision });
    }
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    if (r2) {
      const origin = r2Origin(), objects = createR2Store();
      if (body?.import) {
        if (process.env.YOMIRU_IMPORT_BLOB !== "1" || process.env.YOMIRU_PAUSE_FEEDBACK !== "1") {
          return response.status(404).end();
        }
        if (await publicationStore().current()) throw new Error("Legacy import has already been activated");
        return response.status(200).json(await importBlobPage(body.import, objects, origin));
      }
      const result = await writePublicationObject(body, { ...objects, origin, activate: (payload, pointer) =>
        activateR2Publication(payload, pointer, { origin, publications: publicationStore(),
          readPrevious: readBlobPublication }) });
      return response.status(200).json(result);
    }
    const result = await writePublicationObject(body, {
      head: async pathname => {
        try { return await head(pathname); }
        catch (error) { if (error instanceof BlobNotFoundError) return null; throw error; }
      },
      put,
    });
    return response.status(200).json(result);
  } catch {
    // Neither credentials nor provider diagnostics are returned to callers.
    return response.status(409).json({ error: "Publication rejected; check object integrity and current revision" });
  }
}
