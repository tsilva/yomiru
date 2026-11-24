import { englishKey, hiraganaKey, practiceDisplayKana, shufflePracticeItems } from "./vocabulary-practice.mjs";

const starKey = "yomiru-dictionary-stars";
const entryBatchSize = 128;
const minimumRoundSize = 22;

export function readDictionaryStars() {
  try {
    const entries = JSON.parse(window.localStorage.getItem(starKey) ?? "[]");
    return new Map(entries.filter(entry => Array.isArray(entry) && entry.length === 2
      && entry.every(value => typeof value === "string")));
  } catch {
    return new Map();
  }
}

export function toggleDictionaryStar(word) {
  const stars = readDictionaryStars();
  if (stars.has(word.root)) stars.delete(word.root);
  else stars.set(word.root, word.id);
  window.localStorage.setItem(starKey, JSON.stringify([...stars]));
  return stars;
}

export function onDictionaryStarsChange(onChange) {
  const update = event => {
    if (event.key === starKey || event.key === null) onChange(readDictionaryStars());
  };
  window.addEventListener("storage", update);
  return () => window.removeEventListener("storage", update);
}

export async function loadDictionaryEntries(ids, loadDictionary, signal) {
  const uniqueIds = [...new Set(ids)].sort();
  const words = [];
  for (let start = 0; start < uniqueIds.length; start += entryBatchSize) {
    const page = await loadDictionary({ ids: uniqueIds.slice(start, start + entryBatchSize) }, signal);
    words.push(...page.words);
  }
  return words;
}

function dictionaryCard(word) {
  const [meaning] = word.meanings;
  const reading = word.reading.normalize("NFKC");
  if (!/^(?=.*[ぁ-ゖァ-ヺ])[ぁ-ゖゝゞァ-ヺヽヾー]+$/u.test(reading) || !meaning || meaning.length > 100) return null;
  const kana = practiceDisplayKana(reading, word.word);
  return { ...word, kana, readingKey: hiraganaKey(kana), meaning, meaningKey: englishKey(meaning),
    acceptable: new Set(word.meanings.map(englishKey)), partOfSpeech: word.pos?.split("/", 1)[0] };
}

function alternativesFor(card, pool) {
  const options = [card];
  const shuffled = shufflePracticeItems(pool);
  const ordered = [...shuffled.filter(other => other.partOfSpeech === card.partOfSpeech),
    ...shuffled.filter(other => other.partOfSpeech !== card.partOfSpeech)];
  for (const other of ordered) {
    if (options.length === 4) break;
    if (options.some(choice => choice.readingKey === other.readingKey
      || [...other.acceptable].some(meaning => choice.acceptable.has(meaning)))) continue;
    options.push(other);
  }
  return options;
}

export function buildWordDrill(starred, frequent, kanaFirst = Math.random() < .5) {
  const byFrequency = (left, right) => right.count - left.count;
  const roots = new Map();
  for (const word of [...starred].sort(byFrequency).concat([...frequent].sort(byFrequency))) {
    if (roots.has(word.root)) continue;
    const card = dictionaryCard(word);
    if (card) roots.set(word.root, card);
  }
  const pool = [...roots.values()];
  const size = Math.max(minimumRoundSize, new Set(starred.map(word => word.root)).size);
  const questions = [];
  for (const card of pool) {
    const options = alternativesFor(card, pool);
    if (options.length !== 4) continue;
    const toKana = (questions.length % 2 === 0) !== kanaFirst;
    questions.push({ card, toKana, choices: shufflePracticeItems(options) });
    if (questions.length === size) break;
  }
  return questions;
}
