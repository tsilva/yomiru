import { createHash } from "node:crypto";

const episodeId = /^tt\d{1,20}:\d{1,8}:\d{1,8}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
export const maxArtworkBytes = 1024 * 1024;

// Read the canvas dimensions from the three WebP encodings. Keep artwork uploads
// bounded and require the gallery's aspect ratio before admitting them to R2.
function dimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString("ascii", 8, 12) !== "WEBP") return [];
  const chunk = bytes.toString("ascii", 12, 16);
  const size = bytes.readUInt32LE(16);
  if (20 + size + (size % 2) > bytes.length) return [];
  if (chunk === "VP8X" && size === 10 && !(bytes[20] & 2)) {
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  }
  if (chunk === "VP8 " && size >= 10 && !(bytes[20] & 1) && bytes.readUIntLE(23, 3) === 0x2a019d) {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L" && size >= 5 && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21);
    return [1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff)];
  }
  return [];
}

export function artworkDigest(bytes) {
  const [width, height] = dimensions(bytes);
  if (bytes.length > maxArtworkBytes || width !== 640 || height !== 360) {
    throw new Error("Episode artwork must be a static 640 × 360 WebP no larger than 1 MiB");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export function artworkDescriptor(videoId, bytes) {
  const sha256 = artworkDigest(bytes);
  return { videoId, sha256, bytes: bytes.length, path: `/library/${sha256}.webp` };
}

export function validateArtworkIndex(index) {
  if (index.artwork === undefined) return;
  if (!Array.isArray(index.artwork) || index.artwork.length > 10000) throw new Error("Invalid episode artwork index");
  const covered = new Set(index.tracks.filter(track => track.type === "series" && !track.superseded)
    .flatMap(track => track.videoIds));
  for (const item of index.artwork) {
    if (!item || typeof item.videoId !== "string" || !episodeId.test(item.videoId) || !covered.delete(item.videoId)
      || typeof item.sha256 !== "string" || !sha256Pattern.test(item.sha256) || item.path !== `/library/${item.sha256}.webp`
      || !Number.isSafeInteger(item.bytes) || item.bytes < 30 || item.bytes > maxArtworkBytes) {
      throw new Error("Invalid episode artwork descriptor");
    }
  }
}

export function validateArtworkAsset(item, bytes) {
  if (item.bytes !== bytes.length || item.sha256 !== artworkDigest(bytes)) {
    throw new Error("Episode artwork failed integrity validation");
  }
}
