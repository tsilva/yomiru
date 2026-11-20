export const masteryBatchSize = 30;

export const formatMastery = value => value.toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}) + "%";

export function selectionMasteryWords(entries, titles) {
  if (!titles?.length) return entries.get("selection:all");
  if (titles.length === 1) return entries.get(`title:${titles[0]}`);
  const combined = entries.get(`selection:${titles.join(",")}`);
  if (combined) return combined;
  const lists = titles.map(id => entries.get(`title:${id}`));
  if (lists.some(words => !words)) return undefined;
  const distinct = new Set();
  for (const words of lists) for (const id of words) distinct.add(id);
  return distinct;
}

export function masteryForWords(words, scores) {
  if (!words) return undefined;
  const total = words.size ?? words.length;
  if (!total) return null;
  let score = 0;
  for (const id of words) score += scores.get(id) ?? 0;
  return score / total;
}
