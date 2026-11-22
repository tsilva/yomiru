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

export function reviewedVocabularyProgress(words, progress) {
  if (!words) return words;
  const distinct = new Set();
  const introduced = new Set();
  const mastered = new Set();
  for (const [id, readingKey, meanings] of words) {
    distinct.add(id);
    const word = progress.get(id);
    if (!wasIntroduced(word)) continue;
    introduced.add(id);
    if (wasMastered(word) && word.readingKey === readingKey && meanings.includes(word.meaningKey)) mastered.add(id);
  }
  return { introduced: introduced.size, mastered: mastered.size, total: distinct.size };
}
