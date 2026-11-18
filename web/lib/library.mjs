import { createHash } from "node:crypto";
import { validateVocabularyIndex } from "./vocabulary.mjs";

const hex = /^[a-f0-9]{64}$/;
const identifier = /^[A-Za-z0-9_.:-]{1,200}$/;
export const publicOrigin = "https://yomiru.tsilva.eu";

export function validateIndex(index) {
  if (index?.version !== 1 || !Array.isArray(index.tracks) || index.tracks.length > 10000) {
    throw new Error("Invalid published library");
  }
  const seen = new Set();
  for (const track of index.tracks) {
    if (!hex.test(track.id) || seen.has(track.id) || !hex.test(track.sha256)
      || track.path !== `/library/${track.sha256}.ass`
      || !Array.isArray(track.videoIds) || !track.videoIds.length
      || !track.videoIds.every(id => typeof id === "string" && identifier.test(id))
      || !["series", "movie"].includes(track.type) || !/^[a-z]{3}$/.test(track.lang)
      || !["romaji", "hiragana", "katakana", "japanese"].includes(track.script)
      || ("superseded" in track && typeof track.superseded !== "boolean")
      || !Number.isInteger(track.bytes) || track.bytes < 1 || track.bytes > 4 * 1024 * 1024
      || !Number.isInteger(track.cues) || track.cues < 1 || track.cues > 15000
      || typeof track.source?.label !== "string" || track.source.label.length > 160) {
      throw new Error("Invalid published track");
    }
    const source = new URL(track.source.url);
    if (source.protocol !== "https:" || source.username || source.password || source.search) {
      throw new Error("Invalid source attribution");
    }
    seen.add(track.id);
  }
  validateVocabularyIndex(index);
  return index;
}

export function validateAsset(track, bytes) {
  if (bytes.length !== track.bytes
    || createHash("sha256").update(bytes).digest("hex") !== track.sha256
    || !bytes.toString("utf8").startsWith("[Script Info]")) {
    throw new Error("Published asset failed integrity validation");
  }
}

export function validVideoQuery(type, id) {
  return ["series", "movie"].includes(type) && typeof id === "string" && identifier.test(id);
}

export function subtitles(index, type, id, origin = publicOrigin) {
  if (!validVideoQuery(type, id)) return [];
  const modes = ["romaji", "hiragana", "katakana", "japanese"];
  const matches = index.tracks.filter(track =>
    !track.superseded && track.type === type && track.videoIds.includes(id));
  const variant = track => `${track.lang}:${track.script}`;
  const anchoredVariants = new Set(matches.filter(track => track.anchor).map(variant));
  return matches.filter(track => track.anchor || !anchoredVariants.has(variant(track)))
    .sort((a, b) => modes.indexOf(a.script) - modes.indexOf(b.script)).map(t => ({
    id: t.id,
    lang: t.lang,
    label: `🦊 ${t.script[0].toUpperCase()}${t.script.slice(1)}`,
    url: `${origin}${t.path}`,
  }));
}
