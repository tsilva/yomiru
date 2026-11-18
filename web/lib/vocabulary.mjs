import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const hex = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9_.:-]{1,200}$/;
export function validateVocabularyIndex(index) {
  if (index.registry !== undefined) validateRegistryDescriptor(index.registry);
  if (index.vocabulary === undefined) return;
  if (!Array.isArray(index.vocabulary) || index.vocabulary.length > 10000) throw new Error("Invalid vocabulary index");
  const episodes = new Set();
  for (const entry of index.vocabulary) {
    if (!hex.test(entry.anchor) || !hex.test(entry.sha256)
      || entry.path !== `/library/${entry.sha256}.vocabulary.json`
      || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 3 * 1024 * 1024
      || !Number.isInteger(entry.words) || entry.words < 0 || entry.words > 20000
      || !Array.isArray(entry.videoIds) || !entry.videoIds.length
      || entry.videoIds.some(v => !id.test(v) || episodes.has(v)
        || !index.tracks.some(t => t.videoIds.includes(v) && t.anchor === entry.anchor))) {
      throw new Error("Invalid vocabulary entry or Japanese anchor");
    }
    entry.videoIds.forEach(v => episodes.add(v));
  }
  for (const track of index.tracks) {
    if (track.anchor !== undefined && (!hex.test(track.anchor) || (index.vocabulary || []).some(
      v => v.videoIds.some(id => track.videoIds.includes(id)) && v.anchor !== track.anchor,
    ))) throw new Error("Translation uses a different Japanese anchor");
  }
}

const string = (s, max = 2000) => typeof s === "string" && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s);
function validLexeme(word) {
  return [word.word, word.reading, word.romaji, word.pos].every(s => string(s, 300)) && !!word.word
    && word.meanings && typeof word.meanings === "object" && !Array.isArray(word.meanings)
    && Object.entries(word.meanings).every(([lang, values]) => /^[a-z]{3}$/.test(lang)
      && Array.isArray(values) && values.length <= 1000 && values.every(s => string(s)));
}

export function validateVocabulary(document) {
  if (![1, 2].includes(document?.version) || !hex.test(document.anchor) || !string(document.analysis, 100)
    || !Array.isArray(document.words) || document.words.length > 20000) throw new Error("Invalid vocabulary document");
  const seen = new Set();
  for (const word of document.words) {
    if (!/^ja-[a-f0-9]{64}$/.test(word.id) || seen.has(word.id)
      || (document.version === 1 && !validLexeme(word))
      || (document.version === 2 && Object.keys(word).some(k => !["id", "count", "forms", "examples"].includes(k)))
      || !Number.isInteger(word.count) || word.count < 1
      || !Array.isArray(word.forms) || word.forms.length > 1000 || !word.forms.every(s => string(s, 300))
      || !Array.isArray(word.examples) || word.examples.length > 2
      || word.examples.some(e => !/^c\d{5}$/.test(e.cue) || !Number.isInteger(e.start)
        || e.start < 0 || e.start > 86400000 || !string(e.japanese))) throw new Error("Invalid vocabulary word");
    seen.add(word.id);
  }
  const d = document.dictionary;
  if (document.version === 1 && d !== null && (!d || ![d.name, d.url, d.copyright, d.license, d.licenseUrl].every(s => string(s, 500))
    || !hex.test(d.sha256))) throw new Error("Invalid dictionary attribution");
  return document;
}

export function validateRegistryDescriptor(entry) {
  if (!entry || !hex.test(entry.sha256) || ![ `/library/${entry.sha256}.registry.json`, `/library/${entry.sha256}.registry.json.gz` ].includes(entry.path)
    || !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 3 * 1024 * 1024
    || !Number.isInteger(entry.words) || entry.words < 0 || entry.words > 20000) throw new Error("Invalid vocabulary registry descriptor");
}

export function validateRegistry(document) {
  if (document?.version !== 1 || !string(document.analysis, 100) || !Array.isArray(document.entries)
    || document.entries.length > 20000 || !Array.isArray(document.dictionaries)
    || document.dictionaries.length > 1000) throw new Error("Invalid vocabulary registry");
  const sources = new Set();
  for (const d of document.dictionaries) {
    if (!d || ![d.name, d.url, d.copyright, d.license, d.licenseUrl].every(s => string(s, 500))
      || !hex.test(d.sha256) || sources.has(d.sha256)) throw new Error("Invalid registry source");
    sources.add(d.sha256);
  }
  const seen = new Set();
  for (const entry of document.entries) {
    if (!/^ja-[a-f0-9]{64}$/.test(entry.id) || seen.has(entry.id) || !validLexeme(entry)
      || entry.word === "*" || entry.pos === "BOS/EOS"
      || !Array.isArray(entry.aliases) || entry.aliases.length > 1000 || !entry.aliases.every(a => string(a, 300))
      || !entry.sources || Object.entries(entry.sources).some(([lang, refs]) => !/^[a-z]{3}$/.test(lang)
        || !Array.isArray(refs) || refs.some(ref => !sources.has(ref)))
      || !entry.meaningStatus || Object.entries(entry.meaningStatus).some(([lang, status]) => !/^[a-z]{3}$/.test(lang)
        || !["dictionary", "proper name", "number", "symbol", "curated", "unresolved"].includes(status))) {
      throw new Error("Invalid master vocabulary entry");
    }
    seen.add(entry.id);
  }
  return document;
}

export function mergeRegistries(previous, incoming, preferIncoming = false) {
  const result = structuredClone(previous || incoming);
  if (!previous || !incoming) return result;
  const entries = new Map(result.entries.map(e => [e.id, e]));
  for (const source of incoming.dictionaries) {
    if (!result.dictionaries.some(d => d.sha256 === source.sha256)) result.dictionaries.push(source);
  }
  for (const entry of incoming.entries) {
    const old = entries.get(entry.id);
    if (!old) { entries.set(entry.id, structuredClone(entry)); continue; }
    old.aliases = [...new Set([...old.aliases, ...entry.aliases])];
    for (const [lang, meanings] of Object.entries(entry.meanings)) {
      if (meanings.length && (preferIncoming || !old.meanings[lang]?.length)) {
        old.meanings[lang] = meanings;
        old.sources[lang] = entry.sources[lang] || [];
        old.meaningStatus[lang] = entry.meaningStatus[lang] || "dictionary";
      }
    }
  }
  result.entries = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  result.dictionaries.sort((a, b) => a.sha256.localeCompare(b.sha256));
  return validateRegistry(result);
}

export function validateRegistryAsset(entry, bytes) {
  validateRegistryDescriptor(entry);
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Registry integrity check failed");
  const registry = decodeRegistry(bytes, entry.path.endsWith(".gz"));
  if (registry.entries.length !== entry.words) throw new Error("Registry count mismatch");
  return registry;
}

export function decodeRegistry(bytes, compressed = false) {
  const content = compressed ? gunzipSync(bytes, { maxOutputLength: 3 * 1024 * 1024 }) : bytes;
  if (content.length > 3 * 1024 * 1024) throw new Error("Decompressed registry exceeds size limit");
  return validateRegistry(JSON.parse(content));
}

export function encodeRegistry(document) {
  validateRegistry(document);
  const content = Buffer.from(JSON.stringify(document));
  if (content.length > 3 * 1024 * 1024) throw new Error("Master vocabulary exceeds the 3 MiB limit");
  const bytes = gzipSync(content);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, descriptor: { sha256, path: `/library/${sha256}.registry.json.gz`, bytes: bytes.length, words: document.entries.length } };
}

export function resolveVocabulary(document, registry) {
  if (!registry) {
    if (document.version === 2) throw new Error("Master vocabulary registry is missing");
    return document;
  }
  const entries = new Map(registry.entries.map(entry => [entry.id, entry]));
  const sources = new Map(registry.dictionaries.map(d => [d.sha256, d]));
  return { ...document, version: 1, dictionary: null, words: document.words.map(occurrence => {
    const entry = entries.get(occurrence.id);
    if (!entry) throw new Error("Episode references an unknown master vocabulary entry");
    const refs = new Set(Object.values(entry.sources).flat());
    return { ...entry, id: occurrence.id, count: occurrence.count, forms: occurrence.forms,
      examples: occurrence.examples, dictionaries: [...refs].map(ref => sources.get(ref)) };
  }) };
}

export function validateVocabularyAsset(entry, bytes) {
  if (bytes.length !== entry.bytes || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error("Vocabulary integrity check failed");
  }
  const document = validateVocabulary(JSON.parse(bytes));
  if (document.anchor !== entry.anchor || document.words.length !== entry.words) throw new Error("Vocabulary identity mismatch");
  return document;
}
