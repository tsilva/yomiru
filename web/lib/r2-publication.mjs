import { decodePublication, storage, validatePointer } from "./published-library.mjs";
import { readPublic, preserveCoverage } from "./publication-io.mjs";
import { createVocabularyResolver, validateRegistryAsset, validateVocabularyAsset } from "./vocabulary.mjs";
import { validateAsset } from "./library.mjs";
import { episodeRows } from "./browse.mjs";

export async function mapBatches(items, operation, size = 6) {
  const result = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(...await Promise.all(items.slice(start, start + size).map(operation)));
  }
  return result;
}

export async function loadPublicationRows(index, loadAsset) {
  const registry = index.registry && validateRegistryAsset(index.registry, await loadAsset(index.registry.path));
  const resolveVocabulary = createVocabularyResolver(registry);
  const lexemes = new Map();
  const episodes = (await mapBatches(index.vocabulary || [], async descriptor => {
    const original = validateVocabularyAsset(descriptor, await loadAsset(descriptor.path));
    const document = resolveVocabulary(original);
    const { words, ...header } = document;
    if (index.registry) header.registry = index.registry.sha256;
    const occurrences = words.map(word => {
      const { id, count, forms, examples, ...lexeme } = word;
      if (registry) lexemes.set(id, { id, ...lexeme });
      const languages = Object.keys(word.meanings).filter(code => word.meanings[code].length > 0);
      return { languages, detail: registry ? { id, count, forms, examples } : word };
    });
    return descriptor.videoIds.map(episode => ({ episode, header, words: occurrences }));
  })).flat();
  return { lexemes: [...lexemes.values()], episodes };
}

export async function activateR2Publication(body, snapshotPointer, {
  origin, publications, fetcher = fetch, readPrevious,
}) {
  const expected = await publications.current();
  const { sha256: revision, path } = snapshotPointer;
  const expectedEtag = expected && `"${expected}"`;
  if (expected ? !body.overwrite || body.etag !== expectedEtag : body.overwrite) {
    throw new Error("Publication changed; refresh before uploading again");
  }
  if (revision === expected) return { publication: revision };
  const load = async (pathname, limit) => {
    const object = await readPublic(`${origin}${pathname}`, fetcher, limit);
    if (!object) throw new Error("Publication object is missing");
    return object.bytes;
  };
  const snapshot = await load(path);
  const next = decodePublication(snapshot, revision);
  if (expected) {
    preserveCoverage(decodePublication(await publications.snapshot(expected), expected).index, next.index);
  } else if (readPrevious) {
    preserveCoverage((await readPrevious()).index, next.index);
  }
  const tracks = [...new Map(next.index.tracks.map(track => [track.path, track])).values()];
  await mapBatches(tracks, async track => {
    validateAsset(track, await load(track.path, track.bytes));
  });
  const rows = await loadPublicationRows(next.index, pathname => load(pathname, 3 * 1024 * 1024));
  await publications.activate({ revision, expected, snapshot, ...rows,
    catalogueRows: episodeRows(next.index, next.catalogue), tracks: next.index.tracks });
  return { publication: revision };
}

export async function readBlobPublication(fetcher = fetch) {
  const file = await readPublic(`${storage.origin}${storage.pointer}`, fetcher, 4096);
  if (!file) throw new Error("Legacy library is missing");
  const pointer = validatePointer(JSON.parse(file.bytes));
  const snapshot = await readPublic(`${storage.origin}${pointer.path}`, fetcher);
  if (!snapshot) throw new Error("Legacy snapshot is missing");
  return { ...decodePublication(snapshot.bytes, pointer.sha256), bytes: snapshot.bytes, pointer };
}
