import { toPracticeCard } from "./practice-deck.mjs";
import { sortVocabulary, vocabularyHistoryBatchSize } from "./vocabulary-study.mjs";

export function vocabularyFromPractice(card) {
  const { id, written, kana, romaji, meaning, partOfSpeech } = card;
  return { id, word: written || kana, reading: kana, romaji, meanings: [meaning], pos: partOfSpeech,
    count: 0, forms: [] };
}

export async function loadPresentedVocabulary(history, loadPage, loadReview, signal) {
  const ids = [...history.keys()];
  const byId = new Map();
  for (let start = 0; start < ids.length; start += vocabularyHistoryBatchSize) {
    const { words } = await loadPage(ids.slice(start, start + vocabularyHistoryBatchSize), signal);
    signal.throwIfAborted();
    for (const word of words) if (history.has(word.id)) byId.set(word.id, word);
  }

  // Reviewed expressions can be playable without an entry in the public corpus.
  const missing = new Set();
  for (const [id, record] of history) {
    if (byId.has(id)) continue;
    if (record.vocabulary) byId.set(id, record.vocabulary);
    else missing.add(id);
  }
  let cursor;
  while (missing.size) {
    const { sources, next } = await loadReview("practice-review", { cursor }, signal);
    signal.throwIfAborted();
    for (const { cards } of sources) {
      for (const row of cards) {
        if (missing.delete(row[0])) byId.set(row[0], vocabularyFromPractice(toPracticeCard(row)));
      }
    }
    if (!next) break;
    cursor = next;
  }
  for (const id of missing) {
    const record = history.get(id);
    const reading = record.readingKey || "";
    const meaning = record.reviewContext?.meaning ?? record.meaningKey;
    byId.set(id, { id, word: reading, reading, meanings: meaning ? [meaning] : [], count: 0, forms: [] });
  }
  return sortVocabulary([...byId.values()]);
}
