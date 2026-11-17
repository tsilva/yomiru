import { createHash } from "node:crypto";

export function fixture(episodes = [1]) {
  const body = Buffer.from("[Script Info]\n; original synthetic fixture\n");
  const checksum = createHash("sha256").update(body).digest("hex");
  const index = { version: 1, revision: "a".repeat(64), tracks: episodes.map(episode => ({
    id: String(episode).padStart(64, "0"), videoIds: [`tt1234567:1:${episode}`],
    type: "series", lang: "eng", script: "romaji", sha256: checksum,
    path: `/library/${checksum}.ass`, bytes: body.length, cues: 1,
    source: { label: "Synthetic source", url: "https://example.test/source" },
  })) };
  const catalogue = { version: 1, libraryRevision: index.revision, shows: {
    tt1234567: { id: "tt1234567", name: "Synthetic show", videos: [] },
  } };
  const bytes = Buffer.from(JSON.stringify({ version: 1, index, catalogue }));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { index, catalogue, bytes, body, pointer: {
    version: 1, sha256, path: `/library/snapshots/${sha256}.json`,
  }, assets: new Map([[index.tracks[0].path, body]]) };
}
