function groupByWord(rows) {
  const words = new Map();
  for (const [id, ...span] of rows) {
    if (typeof id !== "string") continue;
    if (!words.has(id)) words.set(id, []);
    words.get(id).push(span);
  }
  return words;
}

export function originalPracticeLine({ source, readingTokens, targets, ...phrase }) {
  if (!source.text?.trim()) return { ...phrase, targets };
  const characters = Array.from(source.text);
  const valid = (start, end) => Number.isInteger(start) && Number.isInteger(end)
    && 0 <= start && start < end && end <= characters.length;
  const sourceTokens = source.tokens ?? [];
  const sourceWords = groupByWord(sourceTokens.map(([start, end, word]) =>
    [source.ids ? source.ids[word] : word, start, end]));
  const heads = sourceTokens.filter(([, , , status]) => status === "ready");
  const hasReviewedHeads = heads.length === targets.length
    && heads.every(([, , word], index) => word === targets[index][0]);
  const starts = new Map(), ends = new Map();
  for (const [id, readings] of groupByWord(readingTokens ?? [])) {
    const occurrences = sourceWords.get(id);
    // Positions within a repeated word are comparable only with full coverage.
    if (occurrences?.length !== readings.length) continue;
    for (const [index, [hs, he, rs, re]] of readings.entries()) {
      const [start, end] = occurrences[index];
      starts.set(`${hs}:${rs}`, start);
      ends.set(`${he}:${re}`, end);
    }
  }
  const romaji = Array.from(phrase.romaji ?? "");
  const japaneseTargets = targets.map(([, hs, he, rs, re, , reviewed], index) => {
    if (reviewed) return valid(...reviewed) ? reviewed : null;
    const head = hasReviewedHeads ? heads[index] : null;
    let start = starts.get(`${hs}:${rs}`);
    const end = ends.get(`${he}:${re}`) ?? head?.[1];
    // Older reviews can contain merged targets that have no peek of their own.
    // An adjacent, aligned target can still establish the start of the phrase.
    if (start === undefined && head) {
      const [, , previousKanaEnd, , previousRomajiEnd] = targets[index - 1] ?? [];
      if (previousKanaEnd === hs && previousRomajiEnd <= rs
          && !romaji.slice(previousRomajiEnd, rs).join("").trim()) {
        start = ends.get(`${previousKanaEnd}:${previousRomajiEnd}`);
        while (start < head[0] && !characters[start].trim()) start++;
      }
      start ??= head[0];
    }
    if (head && (start > head[0] || end < head[1])) return null;
    return valid(start, end) ? [start, end] : null;
  });
  return { ...phrase, targets, japanese: source.text, japaneseTargets };
}
