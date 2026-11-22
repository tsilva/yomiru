import { parseArgs } from "node:util";
import { publicOrigin } from "../lib/library.mjs";
import { createAdminExecutor } from "./upload-library.mjs";

const { values } = parseArgs({ options: {
  apply: { type: "boolean" }, deployment: { type: "string" }, executor: { type: "string" },
  "track-id": { type: "string", multiple: true },
} });
const hash = /^[a-f0-9]{64}$/;
const admin = values.apply && createAdminExecutor(values.executor, values.deployment);
const response = await fetch(`${publicOrigin}/library/index.json?playback=${Date.now()}`, {
  signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
});
if (!response.ok) throw new Error("Could not read the public subtitle library");
const publication = response.headers.get("X-Yomiru-Publication");
const { tracks } = await response.json();
if (!hash.test(publication) || !Array.isArray(tracks)) throw new Error("Invalid subtitle library revision");
const pending = tracks.filter(track => !track.superseded && !track.playbackReady);
const selected = new Set(values["track-id"] ?? pending.map(track => track.id));
const trackIds = pending.filter(track => selected.has(track.id)).map(track => track.id).sort();
if (trackIds.length !== selected.size) throw new Error("Selected IDs must identify active legacy tracks");

if (!admin || !trackIds.length) {
  console.log(JSON.stringify({ publication, pending: trackIds.length, trackIds }));
} else {
  const { state } = await admin({ incremental: { action: "state" } });
  if (!state?.serving || state.revision !== publication || !hash.test(state.catalogueRevision)) {
    throw new Error("The public and protected catalogue revisions differ. Refresh and try again.");
  }
  let previous = state.catalogueRevision;
  for (let start = 0; start < trackIds.length; start += 8) {
    const batch = trackIds.slice(start, start + 8);
    const result = await admin({ incremental: { action: "migrate-playback-tracks", previous, trackIds: batch } });
    if (!hash.test(result.revision) || !Array.isArray(result.tracks) || result.tracks.length !== batch.length
      || result.tracks.some(({ id, previous }) => !hash.test(id) || !batch.includes(previous))) {
      throw new Error("Playback migration was not confirmed");
    }
    console.log(JSON.stringify(result));
    previous = result.revision;
  }
}
