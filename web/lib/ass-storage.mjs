import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const maxAssBytes = 4 * 1024 * 1024;
export const assContentType = "text/x-ssa; charset=utf-8";
const hash = /^[a-f0-9]{64}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const hasGzipHeader = bytes => bytes[0] === 0x1f && bytes[1] === 0x8b;

export function decodeStoredAss(bytes) {
  return hasGzipHeader(bytes) ? gunzipSync(bytes, { maxOutputLength: maxAssBytes }) : bytes;
}

export function gzipAss(bytes) {
  const compressed = gzipSync(bytes, { level: 9 });
  if (compressed.length > maxAssBytes) throw new Error("Compressed subtitle exceeds the asset limit");
  const sha256 = digest(compressed);
  return { compressed, path: `/library/${sha256}.ass`,
    storage: { encoding: "gzip", sha256, bytes: compressed.length } };
}

export function validAssPath(track) {
  if (typeof track.sha256 !== "string" || !hash.test(track.sha256)) return false;
  if (!Object.hasOwn(track, "storage")) return track.path === `/library/${track.sha256}.ass`;
  const storage = track.storage;
  return storage?.encoding === "gzip" && typeof storage.sha256 === "string" && hash.test(storage.sha256)
    && storage.sha256 !== track.sha256 && track.path === `/library/${storage.sha256}.ass`
    && Number.isSafeInteger(storage.bytes) && storage.bytes >= 1 && storage.bytes <= maxAssBytes;
}

export function assReadLimit(track) {
  return Math.max(track.bytes, track.storage?.bytes ?? 0);
}

export function matchesAssHead(track, asset) {
  return Boolean(asset && asset.size === (track.storage?.bytes ?? track.bytes)
    && (track.storage ? asset.encoding === "gzip" : !asset.encoding || asset.encoding === "identity"));
}
