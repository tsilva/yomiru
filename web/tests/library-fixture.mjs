import { createHash } from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

export function addVocabulary(index, assets, tracks = index.tracks) {
  const anchor = digest("original synthetic Japanese source");
  const bytes = Buffer.from(JSON.stringify({ version: 1, anchor, analysis: "test", dictionary: null, words: [] }));
  const sha256 = digest(bytes);
  const path = `/library/${sha256}.vocabulary.json`;
  for (const track of tracks) track.anchor = anchor;
  index.vocabulary = [{ videoIds: tracks.flatMap(track => track.videoIds),
    anchor, sha256, path, bytes: bytes.length, words: 0 }];
  assets.set(path, bytes);
}

export function fixture(episodes = [1], { type = "series", vocabulary = [] } = {}) {
  const body = Buffer.from("[Script Info]\n; original synthetic fixture\n");
  const checksum = digest(body);
  const trackPath = `/library/${checksum}.ass`;
  const index = { version: 1, revision: "a".repeat(64), tracks: episodes.map(episode => ({
    id: String(episode).padStart(64, "0"),
    videoIds: [type === "movie" ? `tt123456${episode}` : `tt1234567:1:${episode}`],
    type, lang: "eng", script: "romaji", sha256: checksum,
    path: trackPath, bytes: body.length, cues: 1,
    source: { label: "Synthetic source", url: "https://example.test/source" },
  })) };
  const catalogue = { version: 1, libraryRevision: index.revision, shows: {} };
  if (type === "movie") catalogue.movies = Object.fromEntries(index.tracks.map(({ videoIds: [id] }) =>
    [id, { id, name: `Synthetic movie ${id}` }]));
  else catalogue.shows.tt1234567 = { id: "tt1234567", name: "Synthetic show", videos: [] };
  const assets = new Map([[trackPath, body]]);
  if (vocabulary.length) addVocabulary(index, assets, index.tracks.filter((_, i) => vocabulary.includes(episodes[i])));
  const bytes = Buffer.from(JSON.stringify({ version: 1, index, catalogue }));
  const sha256 = digest(bytes);
  return { index, catalogue, bytes, body, pointer: {
    version: 1, sha256, path: `/library/snapshots/${sha256}.json`,
  }, assets };
}
