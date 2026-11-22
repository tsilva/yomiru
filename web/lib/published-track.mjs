import { validateAsset } from "./library.mjs";
import { readPublic } from "./publication-io.mjs";
import { assetUrl } from "./published-library.mjs";
import { createR2Store } from "./r2.mjs";
import { databaseEnabled } from "./storage-config.mjs";

export async function readPublishedTrack(track) {
  if (!/^[a-f0-9]{64}$/.test(track.sha256) || track.path !== `/library/${track.sha256}.ass`
    || !Number.isSafeInteger(track.bytes) || track.bytes < 1 || track.bytes > 4 * 1024 * 1024) {
    throw new Error("Invalid published subtitle descriptor");
  }
  const asset = databaseEnabled() ? await createR2Store().read(track.path.slice(1), track.bytes)
    : await readPublic(assetUrl(track.path), fetch, track.bytes);
  if (!asset) throw new Error("Subtitle asset unavailable");
  validateAsset(track, asset.bytes);
  return asset.bytes;
}
