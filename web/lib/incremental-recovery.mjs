import { createHash } from "node:crypto";
import { decodePublication } from "./published-library.mjs";
import { encodeRegistry } from "./vocabulary.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function legacyRecoveryPackage(store, revision) {
  const { index, catalogue } = await store.library(revision);
  const ids = (index.vocabulary || []).flatMap(entry => entry.videoIds);
  const documents = await store.documents(revision, ids);
  if (documents.size !== ids.length) throw new Error("Vocabulary disappeared during recovery preparation");
  const dictionary = new Map(), dictionaries = new Map(), packaged = new Map(), assets = new Map();
  for (const id of ids) {
    const data = documents.get(id);
    const words = data.words.map(({ count, forms, formReadings, examples, dictionaries: sources, ...lexeme }) => {
      for (const source of sources || []) dictionaries.set(source.sha256, source);
      dictionary.set(lexeme.id, { ...lexeme, aliases: lexeme.aliases || [], sources: lexeme.sources || {},
        meaningStatus: lexeme.meaningStatus || {} });
      return { id: lexeme.id, count, forms, ...(formReadings && { formReadings }), examples };
    });
    const bytes = Buffer.from(JSON.stringify({ version: 2, anchor: data.anchor, analysis: data.analysis, words }));
    const sha256 = hash(bytes), path = `/library/${sha256}.vocabulary.json`;
    if (!packaged.has(sha256)) {
      packaged.set(sha256, { path, sha256, bytes: bytes.length, anchor: data.anchor, words: words.length, videoIds: [] });
      assets.set(path, bytes);
    }
    packaged.get(sha256).videoIds.push(id);
  }
  const entries = [...dictionary.values()].sort((a, b) => a.id.localeCompare(b.id));
  const registry = encodeRegistry({ version: 1, analysis: "incremental-recovery", entries,
    dictionaries: [...dictionaries.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) });
  assets.set(registry.descriptor.path, registry.bytes);
  const vocabulary = [...packaged.values()];
  const restored = { version: 1, tracks: index.tracks, vocabulary, registry: registry.descriptor,
    ...(index.artwork && { artwork: index.artwork }) };
  restored.revision = hash(Buffer.from(JSON.stringify(restored)));
  const metadata = { ...catalogue, libraryRevision: restored.revision };
  const bytes = Buffer.from(JSON.stringify({ version: 1, index: restored, catalogue: metadata }));
  const sha256 = hash(bytes), path = `/library/snapshots/${sha256}.json`;
  decodePublication(bytes, sha256);
  assets.set(path, bytes);
  return { index: restored, catalogue: metadata, bytes, assets, pointer: { version: 1, path, sha256 } };
}
