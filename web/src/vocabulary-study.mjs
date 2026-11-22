import { toRomaji } from "wanakana";

const japanese = new Intl.Collator("ja");
const english = new Intl.Collator("en", { sensitivity: "base" });
const searchableWords = new WeakMap();
const romanizedForms = new WeakMap();
const categories = new Map([
  ["名詞", "Noun"],
  ["代名詞", "Pronoun"],
  ["動詞", "Verb"],
  ["形容詞", "Adjective"],
  ["形状詞", "Adjective"],
  ["連体詞", "Adnominal"],
  ["副詞", "Adverb"],
  ["助詞", "Particle"],
  ["助動詞", "Auxiliary"],
  ["感動詞", "Interjection"],
  ["接続詞", "Conjunction"],
  ["接頭辞", "Prefix"],
  ["接尾辞", "Suffix"],
]);
export const vocabularyCategories = [...new Set([...categories.values(), "Other"])].sort();
export const vocabularyCategoryMap = Object.fromEntries(categories);

export function vocabularyCategory(pos) {
  return categories.get(pos?.split("/")[0]) ?? "Other";
}

export function vocabularyMeanings(word) {
  return [...word.meanings].filter(meaning => meaning.trim());
}

const compareNumbers = (a, b) => a - b;
export const vocabularyPageSize = 40;
export const vocabularyHistoryBatchSize = 128;
export const vocabularyColumns = new Map([
  ["japanese", { label: "Japanese", value: word => word.reading || word.word, compare: japanese.compare }],
  ["meaning", { label: "Meaning", value: word => vocabularyMeanings(word)[0] }],
  ["category", { label: "Category", value: word => vocabularyCategory(word.pos) }],
  ["frequency", { label: "Frequency", value: word => word.count, compare: compareNumbers }],
]);

export const vocabularySortColumns = new Map([
  ...vocabularyColumns,
  // Keep accepting CSV requests from older versions of the word browser.
  ["otherMeanings", { value: word => vocabularyMeanings(word)[1] }],
]);

// Start from selection frequency order to keep ties stable across column sorts.
export function sortVocabularyByColumn(words, { column, direction }, definition = vocabularySortColumns.get(column)) {
  const { value, compare = english.compare } = definition;
  const multiplier = direction === "descending" ? -1 : 1;
  return words.map(word => ({ word, key: value(word) })).sort((a, b) => {
    if (a.key == null) return b.key == null ? 0 : 1;
    if (b.key == null) return -1;
    return multiplier * compare(a.key, b.key);
  }).map(({ word }) => word);
}

export function sortVocabulary(words) {
  return [...words].sort((a, b) =>
    b.count - a.count
    || japanese.compare(a.reading, b.reading)
    || japanese.compare(a.word, b.word)
    || a.id.localeCompare(b.id));
}

function searchText(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/gu, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60))
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}
export const vocabularySearchTerms = value => searchText(value).trim().split(/\s+/u).filter(Boolean);

function glossPrefix(term) {
  const literal = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${literal}`, "u");
}

function searchableWord(word) {
  let text = searchableWords.get(word);
  if (!text) {
    const forms = [...word.forms, ...(word.formReadings ?? [])];
    text = {
      japanese: searchText([word.word, word.reading, word.romaji, ...(word.aliases || []), ...forms].join(" ")),
      glosses: searchText([...word.meanings].join(" ")),
    };
    searchableWords.set(word, text);
  }
  return text;
}

function searchableFormRomaji(word) {
  let text = romanizedForms.get(word);
  if (text === undefined) {
    const forms = [...word.forms, ...(word.formReadings ?? [])];
    const kana = forms.map(form => form.normalize("NFKC"))
      .filter(form => /^[ぁ-ゖァ-ヺー]+$/u.test(form));
    text = searchText(toRomaji(kana.join(" ")));
    romanizedForms.set(word, text);
  }
  return text;
}

export function filterVocabulary(words, query, category = "") {
  const terms = vocabularySearchTerms(query).map(text => ({
    text, gloss: glossPrefix(text), canMatchRomaji: /^[a-z'-]+$/u.test(text),
  }));
  if (!terms.length && !category) return words;
  return words.filter(word => {
    if (category && vocabularyCategory(word.pos) !== category) return false;
    if (!terms.length) return true;
    const { japanese, glosses } = searchableWord(word);
    return terms.every(({ text, gloss, canMatchRomaji }) => {
      if (japanese.includes(text) || gloss.test(glosses)) return true;
      return canMatchRomaji && searchableFormRomaji(word).includes(text);
    });
  });
}
