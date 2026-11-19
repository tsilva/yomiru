import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const digest = data => createHash("sha256").update(data).digest("hex");
const hash = /^[a-f0-9]{64}$/;
const wordId = /^ja-[a-f0-9]{64}$/;
const cueId = /^c\d{5}$/;

export function sourceArchiveObject(path) {
  return /^(?:sources\/[a-f0-9]{64}\.(?:srt|ass|ssa|vtt)|analyses\/[a-f0-9]{64}\.json\.gz|manifests\/[a-f0-9]{64}\.json)$/.test(path);
}

async function verifiedObject(descriptor, pattern, limit, read) {
  const { path, sha256, bytes } = descriptor || {};
  if (!hash.test(sha256) || !pattern.test(path) || !path.split("/")[1].startsWith(`${sha256}.`)
    || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limit) throw new Error("Invalid private source descriptor");
  const data = await read(path, bytes);
  if (!Buffer.isBuffer(data) || data.length !== bytes || digest(data) !== sha256) {
    throw new Error("Private source object failed integrity validation");
  }
  return data;
}

function validateAnalysis(data, anchor, cueCount) {
  const analysis = JSON.parse(gunzipSync(data, { maxOutputLength: 64 * 1024 * 1024 }));
  const { wordIds, cues } = analysis;
  if (analysis.version !== 1 || analysis.anchor !== anchor || analysis.offsets !== "unicode-codepoints"
    || typeof analysis.analysis !== "string" || !Array.isArray(wordIds) || wordIds.some(id => !wordId.test(id))
    || new Set(wordIds).size !== wordIds.length || !Array.isArray(cues) || cues.length < 1 || cues.length > 15000
    || (cueCount != null && cues.length !== cueCount)) {
    throw new Error("Invalid private source analysis");
  }
  const seen = new Set();
  const counts = new Map();
  for (const cue of cues) {
    if (!cueId.test(cue.id) || seen.has(cue.id) || typeof cue.text !== "string" || !(cue.text || cue.japanese)
      || (cue.japanese !== undefined && typeof cue.japanese !== "string")
      || !Number.isSafeInteger(cue.start) || cue.start < 0 || !Number.isSafeInteger(cue.end)
      || cue.end <= cue.start || cue.end > 86400000 || !Array.isArray(cue.tokens)) {
      throw new Error("Invalid private source cue");
    }
    seen.add(cue.id);
    const characters = [...cue.text];
    const size = characters.length;
    let cursor = 0;
    for (const token of cue.tokens) {
      if (!Array.isArray(token) || token.length !== 3) throw new Error("Invalid private source token");
      const [start, end, word] = token;
      if (!Number.isSafeInteger(start) || start < cursor || !Number.isSafeInteger(end) || end <= start || end > size
        || (word !== null && (!Number.isSafeInteger(word) || word < 0 || word >= wordIds.length))) {
        throw new Error("Invalid private source token position");
      }
      if (characters.slice(cursor, start).some(character => /\S/u.test(character))) {
        throw new Error("Private source analysis omits cue text");
      }
      cursor = end;
      if (word !== null) {
        const id = wordIds[word];
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    if (characters.slice(cursor).some(character => /\S/u.test(character))) {
      throw new Error("Private source analysis omits cue text");
    }
  }
  const identity = cues.map(cue => ({ end: cue.end, id: cue.id, japanese: cue.japanese ?? cue.text, start: cue.start }));
  if (digest(JSON.stringify(identity)) !== anchor) throw new Error("Private source cue identity does not match the tracks");
  return counts;
}

export async function verifySourceArchive(manifest, anchor, cueCount, read) {
  const data = await verifiedObject(manifest, /^manifests\/[a-f0-9]{64}\.json$/, 65536, read);
  const { version, anchor: archivedAnchor, original, analysis, excludedMusic, publishedSelection } = JSON.parse(data);
  if (version !== 1 || archivedAnchor !== anchor || typeof excludedMusic !== "boolean"
    || (publishedSelection !== undefined && publishedSelection !== true)) {
    throw new Error("Private source archive does not match the tracks");
  }
  await verifiedObject(original, /^sources\/[a-f0-9]{64}\.(?:srt|ass|ssa|vtt)$/, 2 * 1024 * 1024, read);
  const encoded = await verifiedObject(analysis, /^analyses\/[a-f0-9]{64}\.json\.gz$/, 3 * 1024 * 1024, read);
  return { version, anchor, manifest, original, analysis, excludedMusic, ...(publishedSelection && { publishedSelection }),
    counts: validateAnalysis(encoded, anchor, cueCount) };
}
