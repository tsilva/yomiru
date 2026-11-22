import { createHash } from "node:crypto";
import { artworkDigest, validateArtworkAsset } from "./episode-artwork.mjs";
import { storage, validatePointer, decodePublication } from "./published-library.mjs";
import { readPublic, preserveCoverage } from "./publication-io.mjs";
import { validateVocabulary, validateVocabularyAsset, decodeRegistry, validateRegistryAsset, resolveVocabulary } from "./vocabulary.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const sameEtag = (a, b) => typeof a === "string" && typeof b === "string"
  && !a.startsWith("W/") && !b.startsWith("W/")
  && a.replace(/^"|"$/g, "") === b.replace(/^"|"$/g, "");

export function protectedAdminHost(request, environment = process.env, r2 = false) {
  // Only the exact deployment hostname is accepted; Vercel Authentication protects it.
  // Reject the public custom domain and alternate aliases even for valid payloads.
  return environment.VERCEL_ENV === "production" && environment.VERCEL_URL
    && request.headers.host === environment.VERCEL_URL
    && (r2 || environment.BLOB_STORE_ID === storage.storeId);
}

export async function writePublicationObject(body, { head, put, fetcher = fetch,
  origin = storage.origin, activate, readObject = pathname => readPublic(`${origin}${pathname}`, fetcher),
} = {}) {
  if (!body || typeof body.path !== "string" || typeof body.content !== "string"
    || body.content.length > 4 * 1024 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)) {
    throw new Error("Invalid upload payload");
  }
  const bytes = Buffer.from(body.content, "base64");
  const checksum = digest(bytes);
  let contentType;
  if (body.path === `/library/${checksum}.ass` && bytes.toString("utf8").startsWith("[Script Info]")) {
    contentType = "text/x-ssa; charset=utf-8";
  } else if (body.path === `/library/snapshots/${checksum}.json`) {
    decodePublication(bytes, checksum);
    contentType = "application/json";
  } else if (body.path === `/library/${checksum}.vocabulary.json`) {
    validateVocabulary(JSON.parse(bytes));
    contentType = "application/json";
  } else if (body.path === `/library/${checksum}.webp`) {
    artworkDigest(bytes);
    contentType = "image/webp";
  } else if ([`/library/${checksum}.registry.json`, `/library/${checksum}.registry.json.gz`].includes(body.path)) {
    const compressed = body.path.endsWith(".gz");
    decodeRegistry(bytes, compressed);
    contentType = compressed ? "application/gzip" : "application/json";
  } else if (body.path === storage.pointer) {
    const pointer = validatePointer(JSON.parse(bytes));
    if (activate) return activate(body, pointer);
    const currentHead = await head(storage.pointer.slice(1));
    if (currentHead && (!body.overwrite || !sameEtag(body.etag, currentHead.etag))) {
      throw new Error("Publication changed; refresh before uploading again");
    }
    if (!currentHead && body.overwrite) throw new Error("Previous publication is missing");
    const nextFile = await readPublic(`${storage.origin}${pointer.path}`, fetcher);
    if (!nextFile) throw new Error("New snapshot is missing");
    const next = decodePublication(nextFile.bytes, pointer.sha256);
    if (currentHead) {
      const currentFile = await readPublic(`${storage.origin}${storage.pointer}`, fetcher, 4096);
      if (!currentFile || !sameEtag(currentFile.etag, currentHead.etag)) {
        throw new Error("Publication cache is not current; try again after propagation");
      }
      const prior = validatePointer(JSON.parse(currentFile.bytes));
      const priorFile = await readPublic(`${storage.origin}${prior.path}`, fetcher);
      if (!priorFile) throw new Error("Previous snapshot is missing");
      preserveCoverage(decodePublication(priorFile.bytes, prior.sha256).index, next.index);
    }
    // Independently ensure the snapshot never exposes missing subtitle objects.
    for (const track of next.index.tracks) {
      const asset = await head(track.path.slice(1));
      if (!asset || asset.size !== track.bytes) throw new Error("Snapshot references a missing asset");
    }
    for (const item of next.index.artwork ?? []) {
      const asset = await readObject(item.path, item.bytes);
      if (!asset) throw new Error("Snapshot references missing artwork");
      validateArtworkAsset(item, asset.bytes);
    }
    let registry;
    if (next.index.registry) {
      const file = await readPublic(`${storage.origin}${next.index.registry.path}`, fetcher, 3 * 1024 * 1024);
      if (!file) throw new Error("Snapshot references a missing master registry");
      registry = validateRegistryAsset(next.index.registry, file.bytes);
    }
    for (const entry of next.index.vocabulary || []) {
      const file = await readPublic(`${storage.origin}${entry.path}`, fetcher, 3 * 1024 * 1024);
      if (!file) throw new Error("Snapshot references missing vocabulary");
      const document = validateVocabularyAsset(entry, file.bytes);
      if (registry || document.version === 2) resolveVocabulary(document, registry);
    }
    await put(storage.pointer.slice(1), bytes, {
      access: "public", addRandomSuffix: false, contentType: "application/json",
      cacheControlMaxAge: 60, allowOverwrite: Boolean(currentHead),
      ...(currentHead ? { ifMatch: currentHead.etag } : {}),
    });
    return { publication: pointer.sha256 };
  } else {
    throw new Error("Only content-addressed subtitle assets and validated snapshots are accepted");
  }
  const pathname = body.path.slice(1);
  if (await head(pathname)) {
    const existing = await readObject(body.path);
    if (!existing?.bytes.equals(bytes)) throw new Error("Immutable storage object differs");
    return { sha256: checksum, unchanged: true };
  }
  const created = await put(pathname, bytes, {
    access: "public", addRandomSuffix: false, allowOverwrite: false,
    contentType, cacheControlMaxAge: 31536000,
  });
  if (created === false) {
    const existing = await readObject(body.path);
    if (!existing?.bytes.equals(bytes)) throw new Error("Immutable storage object differs");
  }
  return { sha256: checksum, unchanged: created === false };
}
