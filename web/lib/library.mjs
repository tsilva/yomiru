import { createHash } from "node:crypto";

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
  return index;
}

export function validateAsset(track, bytes) {
  if (bytes.length !== track.bytes
    || createHash("sha256").update(bytes).digest("hex") !== track.sha256
    || !bytes.toString("utf8").startsWith("[Script Info]")) {
    throw new Error("Published asset failed integrity validation");
  }
}

export function subtitleLabel(track, status = "") {
  const mode = `${track.script[0].toUpperCase()}${track.script.slice(1)}`;
  return `🦊 ${mode}${status ? ` ${status}` : ""} · ${track.source.label} · timing unverified`;
}

export function subtitles(index, type, id, origin = publicOrigin) {
  if (!["series", "movie"].includes(type) || typeof id !== "string" || !identifier.test(id)) {
    return [];
  }
  const modes = ["romaji", "hiragana", "katakana", "japanese"];
  return index.tracks.filter(t => t.type === type && t.videoIds.includes(id))
    .sort((a, b) => modes.indexOf(a.script) - modes.indexOf(b.script)).map(t => ({
    id: t.id,
    // Group the Japanese learning variants together; t.lang remains the meaning language.
    lang: "jpn",
    label: subtitleLabel(t),
    url: `${origin}${t.path}`,
  }));
}
