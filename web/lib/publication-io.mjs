export async function readPublic(url, fetcher = fetch, limit = 16 * 1024 * 1024) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30000), redirect: "error", cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Storage read failed (${response.status})`);
  const parts = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Storage response exceeds limit");
    parts.push(chunk);
  }
  return { bytes: Buffer.concat(parts), etag: response.headers.get("etag") };
}

export function preserveCoverage(previous, next) {
  for (const old of previous.tracks) {
    if (!next.tracks.some(t => t.type === old.type && t.lang === old.lang
      && t.script === old.script && t.source.label === old.source.label
      && t.source.url === old.source.url
      && old.videoIds.every(id => t.videoIds.includes(id)))) {
      throw new Error("Upload would remove existing episode/source/display coverage");
    }
  }
}
