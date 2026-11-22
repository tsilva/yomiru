import { wasIntroduced, wasMastered } from "./vocabulary-practice.mjs";

export const masteryBatchSize = 30;

export function vocabularyProgressForWords(words, progress) {
  if (!words) return words;
  let introduced = 0;
  let mastered = 0;
  for (const id of words) {
    const word = progress.get(id);
    if (!wasIntroduced(word)) continue;
    introduced++;
    if (wasMastered(word)) mastered++;
  }
  return { introduced, mastered, total: words.size ?? words.length };
}
