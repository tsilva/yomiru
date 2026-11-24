import { toPracticeCard } from "./practice-deck.mjs";
import { vocabularyHistoryIndexBatchSize } from "./vocabulary-study.mjs";

export function vocabularyFromPractice(card) {
  const { id, written, kana, romaji, meaning, partOfSpeech } = card;
  return { id, word: written || kana, reading: kana, romaji, meanings: [meaning], pos: partOfSpeech,
    count: 0, forms: [] };
}

export function rememberedVocabulary(id, record) {
  if (record.vocabulary) return record.vocabulary;
  const reading = record.readingKey || "";
  const meaning = record.reviewContext?.meaning ?? record.meaningKey;
  return { id, word: reading, reading, meanings: meaning ? [meaning] : [], count: 0, forms: [] };
}

export async function loadVocabularyBatches(ids, view, query, loadPage, signal) {
  const batches = [];
  for (let start = 0; start < ids.length; start += vocabularyHistoryIndexBatchSize) {
    batches.push(ids.slice(start, start + vocabularyHistoryIndexBatchSize));
  }
  const key = view === "index" ? "words" : "matches";
  const result = [];
  const concurrency = 3;
  for (let start = 0; start < batches.length; start += concurrency) {
    signal.throwIfAborted();
    const pages = await Promise.all(batches.slice(start, start + concurrency)
      .map(batch => loadPage(view, batch, query, signal)));
    for (const page of pages) result.push(...page[key]);
  }
  signal.throwIfAborted();
  return result;
}

// Older browsers may have introduced reviewed expressions before saving a
// display snapshot locally. Recover those cards without holding up the list.
export async function recoverLegacyVocabulary(ids, loadReview, signal, onWords) {
  const missing = new Set(ids);
  let cursor;
  while (missing.size) {
    const { sources, next } = await loadReview("practice-review", { cursor }, signal);
    signal.throwIfAborted();
    const found = [];
    for (const { cards } of sources) {
      for (const row of cards) {
        if (missing.delete(row[0])) found.push(vocabularyFromPractice(toPracticeCard(row)));
      }
    }
    if (found.length) onWords(found);
    if (!next || next === cursor) break;
    cursor = next;
  }
}
