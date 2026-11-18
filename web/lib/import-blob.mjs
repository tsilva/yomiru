import { list } from "@vercel/blob";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { storage } from "./published-library.mjs";
import { readPublic } from "./publication-io.mjs";
import { privateBlobIO } from "./compatibility-storage.mjs";
import { validateContext } from "./feedback-links.mjs";
import { databaseFeedbackIO, importCompatibilityGroup } from "./database-feedback.mjs";
import { database } from "./database.mjs";
import { mapBatches } from "./r2-publication.mjs";

const prefixes = new Map([
  ["objects", "library/"], ["links", "feedback-links/v1/"], ["votes", "compatibility/v1/"],
]);
const objectPattern = /^library\/(?:snapshots\/)?([0-9a-f]{64})\.(ass|json|vocabulary\.json|registry\.json(?:\.gz)?)$/;
const linkPattern = /^feedback-links\/v1\/([A-Za-z0-9_-]{12})\.json$/;
const votePattern = /^compatibility\/v1\/([a-f0-9]{64})\.json$/;

export async function importBlobPage({ phase, cursor }, objects, origin, {
  listPage = list, privateIO = privateBlobIO, sql = database, fetcher = fetch, environment = process.env,
} = {}) {
  const prefix = prefixes.get(phase);
  if (!prefix || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 4096))) {
    throw new Error("Invalid legacy import request");
  }
  const storeId = phase === "objects" ? environment.BLOB_STORE_ID : environment.COMPATIBILITY_STORE_ID;
  if (!storeId || (phase === "objects" && storeId !== storage.storeId)) {
    throw new Error("Legacy storage binding is missing");
  }
  const page = await listPage({ storeId, prefix, limit: 12, cursor, abortSignal: AbortSignal.timeout(8000) });
  if (page.hasMore && (!page.cursor || page.cursor === cursor)) throw new Error("Invalid legacy listing");
  const imported = await mapBatches(page.blobs, async ({ pathname }) => {
    if (phase === "objects") {
      const match = objectPattern.exec(pathname);
      if (!match) return false;
      const source = await readPublic(`${storage.origin}/${pathname}`, fetcher, 4 * 1024 * 1024);
      if (!source || createHash("sha256").update(source.bytes).digest("hex") !== match[1]) {
        throw new Error("Legacy object failed verification");
      }
      const type = match[2] === "ass" ? "text/x-ssa; charset=utf-8"
        : match[2].endsWith(".gz") ? "application/gzip" : "application/json";
      await objects.put(pathname, source.bytes, { contentType: type });
      const target = await readPublic(`${origin}/${pathname}`, fetcher, 4 * 1024 * 1024);
      if (!target?.bytes.equals(source.bytes)) throw new Error("R2 object failed readback");
      return true;
    }

    const match = (phase === "links" ? linkPattern : votePattern).exec(pathname);
    if (!match) throw new Error("Invalid private legacy object path");
    const record = await privateIO.read(pathname);
    if (!record) throw new Error("Legacy feedback record is missing");
    if (phase === "votes") {
      await importCompatibilityGroup(sql(), match[1], record.state);
    } else {
      const context = validateContext(record.state, match[1]);
      const io = databaseFeedbackIO(sql);
      if (!await io.write(pathname, context) && !isDeepStrictEqual((await io.read(pathname))?.state, context)) {
        throw new Error("Feedback link differs from the legacy record");
      }
    }
    return true;
  }, 3);
  return { imported: imported.filter(Boolean).length, cursor: page.hasMore ? page.cursor : null };
}
