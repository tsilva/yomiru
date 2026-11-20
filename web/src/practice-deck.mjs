import { masteryAt, practiceDisplayKana, selectionPracticeStats } from "./vocabulary-practice.mjs";

export const practicePageSize = 24;
export const practiceReviewSize = 12;
export const practiceCheckLimit = 128;
export const practiceEligibility = "no-particles";
export const practicePageVersion = "context-v2";
export const sharedPracticeSelectionLimit = 4;

const kanji = /[\p{Script=Han}〻]/u;
const kanaCharacters = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;

function readableContext([, kana, romaji, hs, he, rs, re]) {
  if (typeof kana !== "string" || typeof romaji !== "string" || !kanaCharacters.test(kana)
    || kanji.test(kana) || !/\p{Script=Latin}/u.test(romaji) || kanji.test(romaji) || kanaCharacters.test(romaji)) return false;
  const kanaChars = Array.from(kana);
  return [hs, he, rs, re].every(Number.isSafeInteger)
    && 0 <= hs && hs < he && he <= kanaChars.length && 0 <= rs && rs < re && re <= Array.from(romaji).length
    && /[\p{L}\p{N}]/u.test([...kanaChars.slice(0, hs), ...kanaChars.slice(he)].join(""));
}

export function toPracticeCard([id, kana, romaji, meaning, readingKey, meaningKey, keys, count, lowerPriority,
  partOfSpeech, examples, written]) {
  const readableExamples = examples?.filter(readableContext);
  return { id, kana: practiceDisplayKana(kana, written), romaji, meaning, readingKey, meaningKey,
    acceptable: new Set(keys), count, lowerPriority,
    partOfSpeech, ...(readableExamples?.length && { examples: readableExamples }) };
}

export function packPracticeCard(card) {
  return [card.id, card.kana, card.romaji, card.meaning, card.readingKey, card.meaningKey,
    [...card.acceptable], card.count, card.lowerPriority, card.partOfSpeech];
}

export function practiceMembership(card, readingKey, meaningKey) {
  return !card ? "0" : card.readingKey === readingKey && card.acceptable.has(meaningKey) ? "2" : "1";
}

export function subtitlePracticePositions(words) {
  const positions = words.flatMap(({ id, forms, examples }) => {
    const example = examples[0];
    if (!example) return [];
    const { start, cue, japanese, offset } = example;
    const [form] = forms;
    const index = form ? japanese.indexOf(form) : -1;
    const position = offset ?? (index < 0 ? null : Array.from(japanese.slice(0, index)).length);
    return [{ id, start, cue, position }];
  });
  positions.sort((a, b) => a.start - b.start || a.cue.localeCompare(b.cue)
    || (a.position ?? Infinity) - (b.position ?? Infinity) || (a.id < b.id ? -1 : 1));
  return positions;
}

export function practiceFromCards(cards, { practice, mode }, subtitleWords) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const checked = practice.checks.map(([id, reading, meaning]) => practiceMembership(byId.get(id), reading, meaning)).join("");
  if (mode === "practice-membership") return { checked };
  const { after } = practice;
  const order = subtitleWords && subtitlePracticePositions(subtitleWords.filter(word => byId.has(word.id)));
  const positions = order && new Map(order.map(({ id }, index) => [id, order.length - index]));
  const rank = card => positions ? positions.get(card.id) : card.count * (card.lowerPriority ? 1 : 4);
  const sorted = cards.filter(card => !positions || positions.has(card.id))
    .sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : 1));
  const start = after ? sorted.findIndex(card => rank(card) < after[0] || (rank(card) === after[0] && card.id > after[1])) : 0;
  const batch = start < 0 ? [] : sorted.slice(start, start + practicePageSize);
  const last = batch.at(-1);
  const sent = new Set(batch.map(card => card.id));
  return { ...(after ? {} : { total: cards.length }), checked, cards: batch.map(packPracticeCard),
    reviews: practice.review.filter(id => byId.has(id) && (!positions || positions.has(id)) && !sent.has(id))
      .map(id => packPracticeCard(byId.get(id))),
    next: last && start + practicePageSize < sorted.length ? [rank(last), last.id] : null };
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
