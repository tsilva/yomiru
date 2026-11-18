import { assetUrl } from "./published-library.mjs";
import { readPublic } from "./publication-io.mjs";
import { createVocabularyResolver, validateRegistryAsset, validateVocabularyAsset } from "./vocabulary.mjs";

export function createBlobVocabularyReader(fetcher = fetch) {
  let registryCache;
  async function loadAsset(descriptor) {
    const file = await readPublic(assetUrl(descriptor.path), fetcher, 3 * 1024 * 1024);
    if (!file) throw new Error("Vocabulary asset is missing");
    return file.bytes;
  }

  function loadRegistry(descriptor) {
    if (registryCache?.sha256 !== descriptor.sha256) {
      const promise = loadAsset(descriptor).then(bytes => createVocabularyResolver(validateRegistryAsset(descriptor, bytes)));
      registryCache = { sha256: descriptor.sha256, promise };
      void promise.catch(() => {
        if (registryCache?.promise === promise) registryCache = undefined;
      });
    }
    return registryCache.promise;
  }

  return async (index, descriptor) => {
    const bytes = await loadAsset(descriptor);
    const document = validateVocabularyAsset(descriptor, bytes);
    if (!index.registry) return document;
    const resolve = await loadRegistry(index.registry);
    return { ...resolve(document), registry: index.registry.sha256 };
  };
}
