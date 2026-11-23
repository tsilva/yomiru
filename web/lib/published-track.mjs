import { validateAsset } from "./library.mjs";
import { assReadLimit, maxAssBytes, validAssPath } from "./ass-storage.mjs";
import { readPublic } from "./publication-io.mjs";
import { assetUrl } from "./published-library.mjs";
import { createR2Store } from "./r2.mjs";
import { databaseEnabled } from "./storage-config.mjs";

export async function readPublishedTrack(track) {
  if (!validAssPath(track) || !Number.isSafeInteger(track.bytes) || track.bytes < 1 || track.bytes > maxAssBytes) {
    throw new Error("Invalid published subtitle descriptor");
  }
  const asset = databaseEnabled() ? await createR2Store().read(track.path.slice(1), assReadLimit(track))
    : await readPublic(assetUrl(track.path), fetch, assReadLimit(track));
  if (!asset) throw new Error("Subtitle asset unavailable");
  validateAsset(track, asset.bytes);
  return asset.bytes;
}
