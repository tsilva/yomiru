const japanese = new Intl.Collator("ja");
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

export function vocabularyCategory(pos) {
  return categories.get(pos?.split("/")[0]) ?? "Other";
}

export function sortVocabulary(words, order) {
  return [...words].sort((a, b) =>
    (order === "frequency" ? b.count - a.count : 0)
    || japanese.compare(a.reading, b.reading)
    || japanese.compare(a.word, b.word)
    || a.id.localeCompare(b.id));
}

function searchText(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/gu, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60))
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}

export function filterVocabulary(words, query, category = "") {
  const terms = searchText(query).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length && !category) return words;
  return words.filter(word => {
    if (category && vocabularyCategory(word.pos) !== category) return false;
    if (!terms.length) return true;
    const text = searchText([word.word, word.reading, word.romaji, ...(word.aliases || []),
      ...word.forms, ...word.meanings].join(" "));
    return terms.every(term => text.includes(term));
  });
}
