import { episodeCode } from "./library-episodes.mjs";

export const vocabularyCacheKey = descriptor => descriptor.registry ? `${descriptor.sha256}:${descriptor.registry}` : descriptor.sha256;

export class VocabularyCounts {
  #documents = new Map();
  #words = new Map();
  #covered = new Map();

  #change(document, delta) {
    for (const word of document.words) {
      const entry = this.#words.get(word.id) ?? { episodes: 0, languages: new Map() };
      entry.episodes += delta;
      for (const [language, meanings] of Object.entries(word.meanings)) {
        if (!meanings.length) continue;
        const previous = entry.languages.get(language) ?? 0;
        const next = previous + delta;
        if (next) entry.languages.set(language, next);
        else entry.languages.delete(language);
        if (!previous || !next) {
          const covered = (this.#covered.get(language) ?? 0) + delta;
          if (covered) this.#covered.set(language, covered);
          else this.#covered.delete(language);
        }
      }
      if (entry.episodes) this.#words.set(word.id, entry);
      else this.#words.delete(word.id);
    }
  }

  update(episodes, documents) {
    const loaded = new Map();
    for (const episode of episodes) {
      const document = documents.get(vocabularyCacheKey(episode.vocabulary));
      if (document) loaded.set(episode.id, document);
    }
    // Touch word contributions only when an episode is added, removed or replaced.
    for (const [id, document] of this.#documents) {
      if (loaded.get(id) !== document) this.#change(document, -1);
    }
    for (const [id, document] of loaded) {
      if (this.#documents.get(id) !== document) this.#change(document, 1);
    }
    this.#documents = loaded;
    return { loaded: loaded.size, total: this.#words.size, covered: new Map(this.#covered) };
  }
}

export function combineVocabulary(episodes, documents, language = "eng") {
  const words = new Map();
  for (const episode of episodes) {
    const document = documents.get(vocabularyCacheKey(episode.vocabulary));
    if (!document || document.anchor !== episode.vocabulary.anchor
      || (episode.vocabulary.registry && document.registry !== episode.vocabulary.registry)) throw new Error("Vocabulary is still loading.");
    for (const word of document.words) {
      let combined = words.get(word.id);
      if (!combined) {
        combined = { ...word, count: 0, forms: new Set(), meanings: new Set(), statuses: new Set(), episodes: [], examples: [], dictionaries: new Map() };
        words.set(word.id, combined);
      }
      combined.count += word.count;
      word.forms.forEach(form => combined.forms.add(form));
      (word.meanings[language] || []).forEach(meaning => combined.meanings.add(meaning));
      if (word.meanings[language]?.length) combined.statuses.add(word.meaningStatus?.[language] || "dictionary");
      const label = `${episode.show} ${episodeCode(episode.season, episode.episode)}`;
      combined.episodes.push(label);
      word.examples.forEach(example => combined.examples.push({ ...example, episode: label, anchor: document.anchor }));
      for (const dictionary of word.dictionaries || (document.dictionary ? [document.dictionary] : [])) {
        if (word.meanings[language]?.length) combined.dictionaries.set(dictionary.sha256, dictionary);
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

export function* vocabularyCsvRows(words, language = "eng") {
  if (!/^[a-z]{3}$/.test(language)) throw new Error("Invalid export language");
  const header = ["vocabulary_id", "japanese", "reading", "romaji", `meaning_${language}`, "forms",
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

export function exportVocabulary(words, language = "eng") {
  return [...vocabularyCsvRows(words, language)].join("");
}
