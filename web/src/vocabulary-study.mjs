import { toRomaji } from "wanakana";

const japanese = new Intl.Collator("ja");
const romanizedForms = new WeakMap();
export const corpusSorts = new Map([
  ["written", {
    label: "Written frequency",
    rankField: "writtenRank",
    source: "Shiberu Japanese Word Frequency List",
    url: "https://shiberu.app/japanese-frequency-list",
  }],
  ["spoken", {
    label: "Spoken frequency",
    rankField: "spokenRank",
    source: "ESPnet YODAS (Japanese YouTube speech)",
    url: "https://huggingface.co/datasets/espnet/yodas",
  }],
]);
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
  const byUses = (a, b) => b.count - a.count;
  const rankField = corpusSorts.get(order)?.rankField;
  const byRank = (a, b) =>
    (a[rankField] ?? Number.MAX_SAFE_INTEGER) - (b[rankField] ?? Number.MAX_SAFE_INTEGER) || byUses(a, b);
  const compare = rankField ? byRank : order === "frequency" ? byUses : () => 0;
  return [...words].sort((a, b) =>
    compare(a, b)
    || japanese.compare(a.reading, b.reading)
    || japanese.compare(a.word, b.word)
    || a.id.localeCompare(b.id));
}

function searchText(value) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/gu, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60))
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}

function glossPrefix(term) {
  const literal = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${literal}`, "u");
}

function searchableFormRomaji(word, forms) {
  let text = romanizedForms.get(word);
  if (text === undefined) {
    const kana = forms.map(form => form.normalize("NFKC"))
      .filter(form => /^[ぁ-ゖァ-ヺー]+$/u.test(form));
    text = searchText(toRomaji(kana.join(" ")));
    romanizedForms.set(word, text);
  }
  return text;
}

export function filterVocabulary(words, query, category = "") {
  const terms = searchText(query).trim().split(/\s+/u).filter(Boolean).map(text => ({
    text, gloss: glossPrefix(text),
  }));
  if (!terms.length && !category) return words;
  return words.filter(word => {
    if (category && vocabularyCategory(word.pos) !== category) return false;
    if (!terms.length) return true;
    const forms = [...word.forms, ...(word.formReadings ?? [])];
    const japaneseText = searchText([word.word, word.reading, word.romaji, ...(word.aliases || []), ...forms].join(" "));
    const glosses = searchText([...word.meanings].join(" "));
    return terms.every(({ text, gloss }) => {
      if (japaneseText.includes(text) || gloss.test(glosses)) return true;
      return /^[a-z'-]+$/u.test(text) && searchableFormRomaji(word, forms).includes(text);
    });
  });
}
