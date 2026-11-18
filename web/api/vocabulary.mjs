import { readPublishedLibrary, assetUrl } from "../lib/published-library.mjs";
import { readPublic } from "../lib/publication-io.mjs";
import { validateVocabularyAsset, validateRegistryAsset, resolveVocabulary } from "../lib/vocabulary.mjs";

export function createHandler({ readLibrary = readPublishedLibrary, fetcher = fetch } = {}) {
  // One immutable registry per function instance. A revision change replaces it.
  let registryCache;
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return response.status(405).end();
    }
    const { episode, revision, registry } = request.query;
    if (typeof episode !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(episode)
      || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)
      || (registry !== undefined && (typeof registry !== "string" || !/^[a-f0-9]{64}$/.test(registry)))) {
      return response.status(400).json({ error: "Choose an episode and vocabulary revision." });
    }
    try {
      const library = await readLibrary();
      const entry = library.index.vocabulary?.find(v => v.videoIds.includes(episode));
      if (!entry) return response.status(404).json({ error: "Vocabulary is not available for this episode yet." });
      if (entry.sha256 !== revision || (library.index.registry?.sha256 || undefined) !== registry) return response.status(409).json({ error: "The library changed. Clear the selection and select the episodes again." });
      const stored = await readPublic(assetUrl(entry.path), fetcher, 3 * 1024 * 1024);
      if (!stored) throw new Error("Missing vocabulary");
      let document = validateVocabularyAsset(entry, stored.bytes);
      if (library.index.registry) {
        const descriptor = library.index.registry;
        if (registryCache?.sha256 !== descriptor.sha256) {
          const file = await readPublic(assetUrl(descriptor.path), fetcher, 3 * 1024 * 1024);
          if (!file) throw new Error("Missing master vocabulary registry");
          registryCache = { sha256: descriptor.sha256, document: validateRegistryAsset(descriptor, file.bytes) };
        }
        document = { ...resolveVocabulary(document, registryCache.document), registry: descriptor.sha256 };
      }
      response.setHeader("Cache-Control", "public, max-age=30");
      response.setHeader("X-Yomiru-Publication", library.publication);
      if (request.method === "HEAD") return response.status(200).end();
      return response.status(200).json(document);
    } catch {
      return response.status(503).json({ error: "Vocabulary is temporarily unavailable. Try again." });
    }
  };
}

export default createHandler();
