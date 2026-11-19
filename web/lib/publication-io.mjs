export async function readPublic(url, fetcher = fetch, limit) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(30000), redirect: "error", cache: "no-store",
  });
  return readStorageResponse(response, limit);
}

export async function readStorageResponse(response, limit = 16 * 1024 * 1024) {
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
  if (previous.registry && !next.registry) throw new Error("Upload would remove the master vocabulary registry");
  for (const old of previous.vocabulary || []) {
    if (old.videoIds.some(id => !(next.vocabulary || []).some(v => v.videoIds.includes(id)))) {
      throw new Error("Upload would remove existing vocabulary coverage");
    }
  }
  for (const old of previous.tracks) {
    if (!next.tracks.some(t => t.type === old.type && t.lang === old.lang
      && t.script === old.script && t.source.label === old.source.label
      && t.source.url === old.source.url
      && old.videoIds.every(id => t.videoIds.includes(id)))) {
      throw new Error("Upload would remove existing episode/source/display coverage");
    }
  }
}

// A subtitle-only publisher may have started before vocabulary was added.
// Retain that published data only when its exact source generation is still present.
export function retainPublishedVocabulary(previous, incoming) {
  const next = structuredClone(incoming);
  if (previous.registry && !next.registry) next.registry = previous.registry;
  for (const entry of previous.vocabulary || []) {
    // Never downgrade an analyzed reference asset to an older embedded word list.
    if (previous.registry && entry.analysis && (next.vocabulary || []).some(v =>
      !v.analysis && v.videoIds.some(id => entry.videoIds.includes(id)))) {
      next.vocabulary = next.vocabulary.filter(v => !v.videoIds.some(id => entry.videoIds.includes(id)));
    }
    const replacement = (next.vocabulary || []).filter(v => v.videoIds.some(id => entry.videoIds.includes(id)));
    if (replacement.some(v => v.anchor !== entry.anchor)) throw new Error("Japanese vocabulary source changed; explicit migration required");
    const missing = entry.videoIds.filter(id => !replacement.some(v => v.videoIds.includes(id)));
    if (!missing.length) continue;
    for (const id of missing) {
      const generations = new Set(previous.tracks.filter(t => t.anchor === entry.anchor && t.videoIds.includes(id)).map(t => t.generation));
      const matches = next.tracks.filter(t => t.videoIds.includes(id)
        && (t.anchor === entry.anchor || (t.generation && generations.has(t.generation))));
      if (!matches.length || matches.some(t => t.anchor && t.anchor !== entry.anchor)) {
        throw new Error("Cannot retain vocabulary after a Japanese source change");
      }
      matches.forEach(t => { t.anchor = entry.anchor; });
    }
    next.vocabulary ||= [];
    next.vocabulary.push({ ...entry, videoIds: missing });
  }
  return next;
}
