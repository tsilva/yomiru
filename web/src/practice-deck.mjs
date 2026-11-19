import { masteryAt, selectionPracticeStats } from "./vocabulary-practice.mjs";

export const practicePageSize = 24;
export const practiceReviewSize = 12;
export const practiceCheckLimit = 128;

export function toPracticeCard([id, kana, romaji, meaning, readingKey, meaningKey, keys, count, lowerPriority, partOfSpeech]) {
  return { id, kana, romaji, meaning, readingKey, meaningKey, acceptable: new Set(keys), count, lowerPriority, partOfSpeech };
}

export function packPracticeCard(card) {
  return [card.id, card.kana, card.romaji, card.meaning, card.readingKey, card.meaningKey,
    [...card.acceptable], card.count, card.lowerPriority, card.partOfSpeech];
}

export function practiceMembership(card, readingKey, meaningKey) {
  return !card ? "0" : card.readingKey === readingKey && card.acceptable.has(meaningKey) ? "2" : "1";
}

export function selectedReviewIds(progress, membership, loaded, now) {
  const due = [], familiar = [];
  for (const [id, word] of progress) {
    if (loaded.has(id) || (membership && !["1", "2"].includes(membership.get(id)))) continue;
    if (membership?.get(id) === "1" || word.needsVerification
      || now >= Math.max(word.dueAt, word.lastSeenAt + word.reviewGap)) due.push(word);
    else if (masteryAt(word, now) >= 55) familiar.push(word);
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  familiar.sort((a, b) => b.score - a.score);
  const familiarSlots = Math.min(familiar.length, 4);
  return [...due.slice(0, practiceReviewSize - familiarSlots), ...familiar.slice(0, familiarSlots)].map(word => word.id);
}

export function deckPracticeStats(total, membership, progress, now) {
  return selectionPracticeStats([], progress, now, undefined, { total, membership });
}
