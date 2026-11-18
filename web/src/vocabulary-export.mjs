import { episodeCode } from "./library-episodes.mjs";

export const vocabularyCacheKey = descriptor => descriptor.registry ? `${descriptor.sha256}:${descriptor.registry}` : descriptor.sha256;

export function summarizeVocabulary(documents) {
  const words = new Set();
  const english = new Set();
  for (const document of documents.values()) {
    for (const word of document.words) {
      words.add(word.id);
      if (word.meanings.eng?.length) english.add(word.id);
    }
  }
  return { total: words.size, covered: english.size ? { eng: english.size } : {} };
}

export function englishDictionaries(word) {
  const englishSources = new Set(word.sources?.eng);
  return word.dictionaries.filter(dictionary => englishSources.has(dictionary.sha256));
}

export function combineVocabulary(episodes, documents) {
  const words = new Map();
  for (const episode of episodes) {
    const document = documents.get(vocabularyCacheKey(episode.vocabulary));
    if (!document || document.anchor !== episode.vocabulary.anchor
      || (episode.vocabulary.registry && document.registry !== episode.vocabulary.registry)) throw new Error("Vocabulary is still loading.");
    for (const word of document.words) {
      let combined = words.get(word.id);
      if (!combined) {
        combined = { ...word, count: 0, forms: new Set(), meanings: new Set(),
          statuses: new Set(), episodes: [], examples: [], dictionaries: new Map() };
        words.set(word.id, combined);
      }
      combined.count += word.count;
      word.forms.forEach(form => combined.forms.add(form));
      const meanings = word.meanings.eng || [];
      meanings.forEach(meaning => combined.meanings.add(meaning));
      const label = `${episode.show} ${episodeCode(episode.season, episode.episode)}`;
      combined.episodes.push(label);
      word.examples.forEach(example => combined.examples.push({ ...example, episode: label, anchor: document.anchor }));
      if (meanings.length) {
        combined.statuses.add(word.meaningStatus?.eng || "dictionary");
        const dictionaries = word.dictionaries ? englishDictionaries(word) : [document.dictionary].filter(Boolean);
        for (const dictionary of dictionaries) combined.dictionaries.set(dictionary.sha256, dictionary);
      }
    }
  }
  return [...words.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function timestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Quote CSV fields and neutralize spreadsheet formulas.
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function* vocabularyCsvRows(words) {
  const header = ["vocabulary_id", "japanese", "reading", "romaji", "meaning_eng", "forms",
    "part_of_speech", "occurrences", "episodes", "example_japanese", "example_episode", "example_timestamp",
    "meaning_status", "dictionary_source", "dictionary_license", "dictionary_version", "japanese_source"];
  yield "\uFEFF" + header.join(",") + "\r\n";
  for (const word of words) {
    const example = word.examples[0];
    const dictionaries = [...word.dictionaries.values()];
    const row = [word.id, word.word, word.reading, word.romaji, [...word.meanings].join("; "),
      [...word.forms].join("; "), word.pos, word.count, word.episodes.join("; "),
      example?.japanese || "", example?.episode || "", example ? timestamp(example.start) : "",
      word.meanings.size ? [...(word.statuses || ["dictionary"])].join("; ") + "; not context-selected" : "meaning unavailable",
      dictionaries.map(d => `${d.name} (${d.url}); ${d.copyright}`).join("; "),
      dictionaries.map(d => `${d.license} (${d.licenseUrl})`).join("; "),
      dictionaries.map(d => d.sha256).join("; "),
      [...new Set(word.examples.map(e => e.anchor))].join("; ")];
    yield row.map(csvCell).join(",") + "\r\n";
  }
}

export function exportVocabulary(words) {
  return [...vocabularyCsvRows(words)].join("");
}
