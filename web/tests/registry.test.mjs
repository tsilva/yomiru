import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateVocabulary, validateRegistryAsset, resolveVocabulary, mergeRegistries, encodeRegistry, decodeRegistry, maxDecodedRegistry } from "../lib/vocabulary.mjs";
import { gzipSync } from "node:zlib";
import { writePublicationObject } from "../lib/admin-publication.mjs";
import { createHandler } from "../api/vocabulary.mjs";
import { combineVocabulary, vocabularyCacheKey } from "../src/vocabulary-export.mjs";
import { retainPublishedVocabulary } from "../lib/publication-io.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const lexeme = { id: `ja-${hash("eat")}`, word: "食べる", reading: "たべる", romaji: "taberu", pos: "動詞/一般",
  aliases: ["食べる"], meanings: { eng: ["to eat"] }, sources: {}, meaningStatus: { eng: "dictionary" } };
const registry = { version: 1, analysis: "test", entries: [lexeme], dictionaries: [] };
function registryAsset(document = registry) {
  const bytes = Buffer.from(JSON.stringify(document)), sha256 = hash(bytes);
  return { bytes, descriptor: { sha256, bytes: bytes.length, path: `/library/${sha256}.registry.json`, words: document.entries.length } };
}
function episode(n = 1) {
  const document = { version: 2, anchor: hash(`source ${n}`), analysis: "test", words: [{ id: lexeme.id,
    count: n, forms: ["食べ"], examples: [{ cue: "c00001", start: 1000, japanese: "パンを食べた。" }] }] };
  const bytes = Buffer.from(JSON.stringify(document)), sha256 = hash(bytes);
  return { document, bytes, descriptor: { sha256, bytes: bytes.length, path: `/library/${sha256}.vocabulary.json`,
    words: 1, anchor: document.anchor, videoIds: [`tt123:1:${n}`], analysis: "test" } };
}
const response = () => ({ statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; },
  json(data) { this.body = data; return this; }, end() {} });

test("episode assets contain references, one master correction changes both episodes without changing IDs or counts", () => {
  const first = episode(1), second = episode(2);
  validateVocabulary(first.document);
  assert.ok(first.document.words.every(w => !("meanings" in w) && !("word" in w)));
  const corrected = structuredClone(registry); corrected.entries[0].meanings.eng = ["consume food"];
  for (const source of [first, second]) {
    const old = resolveVocabulary(source.document, registry), fixed = resolveVocabulary(source.document, corrected);
    assert.deepEqual(old.words.map(w => [w.id, w.count]), fixed.words.map(w => [w.id, w.count]));
    assert.deepEqual(fixed.words[0].meanings.eng, ["consume food"]);
  }
  assert.throws(() => resolveVocabulary(first.document, { ...registry, entries: [] }), /unknown master/);
  assert.throws(() => resolveVocabulary(first.document), /missing/);
  assert.throws(() => validateVocabulary({ ...first.document, words: [{ ...first.document.words[0], meanings: {} }] }), /Invalid vocabulary word/);
});

test("registry integrity, word uniqueness and source provenance are checked", () => {
  const asset = registryAsset();
  validateRegistryAsset(asset.descriptor, asset.bytes);
  assert.throws(() => validateRegistryAsset(asset.descriptor, Buffer.from("{}")), /integrity/);
  for (const document of [{ ...registry, entries: [lexeme, lexeme] },
    { ...registry, entries: [{ ...lexeme, word: "*" }] },
    { ...registry, entries: [{ ...lexeme, sources: { eng: [hash("unknown source")] } }] }]) {
    const bad = registryAsset(document); assert.throws(() => validateRegistryAsset(bad.descriptor, bad.bytes), /Invalid master/);
  }
});

test("compressed master uploads preserve integrity and enforce decompressed size limits", async () => {
  const asset = encodeRegistry(registry);
  assert.ok(asset.descriptor.path.endsWith(".registry.json.gz"));
  assert.deepEqual(validateRegistryAsset(asset.descriptor, asset.bytes), registry);
  assert.throws(() => decodeRegistry(gzipSync(Buffer.alloc(maxDecodedRegistry + 1, " ")), true));
  let writes = 0;
  await writePublicationObject({ path: asset.descriptor.path, content: asset.bytes.toString("base64") }, {
    head: async () => null, put: async (path, bytes, options) => {
      assert.equal(options.contentType, "application/gzip");
      assert.equal(options.allowOverwrite, false);
      assert.deepEqual(bytes, asset.bytes); writes++;
    },
  });
  assert.equal(writes, 1);
});

test("public vocabulary reads cache a pinned master revision and reject stale registry selections", async () => {
  const a = episode(), b = episode(2), oldRegistry = registryAsset();
  let current = oldRegistry;
  const files = new Map([[a.descriptor.path, a.bytes], [b.descriptor.path, b.bytes], [oldRegistry.descriptor.path, oldRegistry.bytes]]);
  const reads = [];
  const handler = createHandler({ readLibrary: async () => ({ index: {
    vocabulary: [a.descriptor, b.descriptor], registry: current.descriptor,
  }, publication: hash("publication") }), fetcher: async url => {
    const path = new URL(url).pathname; reads.push(path);
    return files.has(path) ? new Response(files.get(path)) : new Response(null, { status: 404 });
  } });
  async function request(source, master = current.descriptor.sha256) {
    const res = response(); await handler({ method: "GET", query: { episode: source.descriptor.videoIds[0],
      revision: source.descriptor.sha256, registry: master } }, res); return res;
  }
  assert.equal((await request(a)).statusCode, 200);
  assert.equal((await request(b)).statusCode, 200);
  assert.equal(reads.filter(p => p === current.descriptor.path).length, 1);
  const updated = structuredClone(registry); updated.entries[0].meanings.eng = ["consume food"];
  current = registryAsset(updated); files.set(current.descriptor.path, current.bytes);
  assert.equal((await request(a, oldRegistry.descriptor.sha256)).statusCode, 409);
  assert.deepEqual((await request(a)).body.words[0].meanings.eng, ["consume food"]);
  assert.deepEqual((await request(b)).body.words[0].meanings.eng, ["consume food"]);
});

test("CSV selection caches distinguish master meaning revisions while counts stay language-independent", () => {
  const a = episode();
  const row = { id: "tt123:1:1", show: "Synthetic", season: 1, episode: 1,
    vocabulary: { ...a.descriptor, registry: hash("registry") } };
  const document = { ...resolveVocabulary(a.document, registry), registry: row.vocabulary.registry };
  const docs = new Map([[vocabularyCacheKey(row.vocabulary), document]]);
  assert.equal(combineVocabulary([row], docs).length, 1);
  assert.equal(combineVocabulary([row], docs, "por").length, 1);
  assert.throws(() => combineVocabulary([{ ...row, vocabulary: { ...row.vocabulary, registry: hash("new revision") } }], docs), /loading/);
});

test("episode publishers retain authoritative meanings and cannot downgrade reference assets", () => {
  const changed = structuredClone(registry); changed.entries[0].meanings.eng = ["new draft"];
  assert.deepEqual(mergeRegistries(registry, changed).entries[0].meanings.eng, ["to eat"]);
  assert.deepEqual(mergeRegistries(registry, changed, true).entries[0].meanings.eng, ["new draft"]);
  const a = episode(), master = registryAsset();
  const previous = { tracks: [{ videoIds: a.descriptor.videoIds, generation: hash("gen"), anchor: a.document.anchor }],
    vocabulary: [a.descriptor], registry: master.descriptor };
  const legacy = { ...a.descriptor }; delete legacy.analysis;
  const next = retainPublishedVocabulary(previous, { tracks: previous.tracks, vocabulary: [legacy] });
  assert.deepEqual(next.registry, master.descriptor);
  assert.deepEqual(next.vocabulary, [a.descriptor]);
});

test("generated Portuguese fills a gap and yields to editorial corrections", () => {
  const generated = structuredClone(registry);
  generated.entries[0].meanings.por = ["comer"];
  const source = { name: "AgentBridge", url: "https://example.test/agentbridge",
    sha256: hash("model/prompt"), copyright: "Yomiru", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" };
  generated.dictionaries.push(source);
  generated.entries[0].sources = { eng: [], por: [source.sha256] };
  generated.entries[0].meaningStatus.por = "generated";
  const merged = mergeRegistries(registry, generated);
  assert.deepEqual(merged.entries[0].meanings.por, ["comer"]);
  assert.equal(merged.entries[0].meaningStatus.por, "generated");
  assert.deepEqual(merged.entries[0].sources.por, [source.sha256]);
  const curated = structuredClone(generated);
  curated.entries[0].meanings.por = ["ingerir alimentos"];
  curated.entries[0].meaningStatus.por = "curated";
  assert.deepEqual(mergeRegistries(merged, curated, true).entries[0], curated.entries[0]);
  assert.deepEqual(mergeRegistries(curated, generated, true).entries[0], curated.entries[0]);
});
