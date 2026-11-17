export function browseFixture(count = 65) {
  const tracks = Array.from({ length: count }, (_, i) => ["romaji", "hiragana", "katakana", "japanese"]
    .flatMap(script => (i === 0 ? ["eng", "por"] : ["eng"]).map(lang => ({
      type: "series", videoIds: [`tt1234567:${i < 40 ? 1 : 2}:${i < 40 ? i + 1 : i - 39}`],
      script, lang, source: { label: "Synthetic source" },
    })))).flat();
  const videos = tracks.filter(t => t.script === "romaji" && t.lang === "eng").map(t => {
    const [id, season, episode] = t.videoIds[0].split(":");
    return { id: `${id}:${season}:${episode}`, season: Number(season), episode: Number(episode),
      title: `Synthetic episode ${season}-${episode}` };
  });
  return { publication: "a".repeat(64), index: { tracks }, catalogue: {
    shows: { tt1234567: { name: "Synthetic show", videos } },
  } };
}
