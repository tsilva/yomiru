import { toRomaji } from "wanakana";
import { englishKey, hiraganaKey, shufflePracticeItems } from "./vocabulary-practice.mjs";

export const quizKeys = ["1", "2", "3", "4"];

export function quizContextSpans(example, targetId) {
  const [, , , kanaStart, kanaEnd, romajiStart, romajiEnd, peeks] = example;
  const target = { kana: [kanaStart, kanaEnd], romaji: [romajiStart, romajiEnd] };
  const words = (peeks ?? []).map(([id, meaning, hs, he, rs, re, written, pos, verbGroup]) =>
    ({ id, meaning, written, kana: [hs, he], romaji: [rs, re],
      ...(pos && { pos }), ...(verbGroup && { verbGroup }) }));
  const overlaps = (a, b) => ["kana", "romaji"].some(script =>
    a[script][0] < b[script][1] && b[script][0] < a[script][1]);
  const blocked = [target, ...words.filter(word => word.id === targetId)];
  const length = (word, script) => word[script][1] - word[script][0];
  words.sort((a, b) => length(b, "kana") - length(a, "kana")
    || length(b, "romaji") - length(a, "romaji"));
  const displayed = [target];
  for (const word of words) {
    if (!blocked.some(span => overlaps(span, word))) {
      displayed.push(word);
      blocked.push(word);
    }
  }
  return displayed.sort((a, b) => a.kana[0] - b.kana[0]);
}

function answerKey(meaningKey) {
  return meaningKey.replace(/^to /, "");
}

function distractors(prompt, cards, meanings = [prompt.meaning]) {
  const answers = new Set([...prompt.acceptable, englishKey(meanings[0])].map(answerKey));
  const used = new Set([...answers, ...meanings.map(englishKey).map(answerKey)]);
  const alternatives = [];
  for (const card of cards) {
    const key = answerKey(card.meaningKey);
    if (card.id === prompt.id || card.readingKey === prompt.readingKey
      || card.romaji === prompt.romaji || used.has(key)
      || [...card.acceptable].some(gloss => answers.has(answerKey(gloss)))) continue;
    alternatives.push(card);
    used.add(key);
    if (meanings.length + alternatives.length === quizKeys.length) break;
  }
  return alternatives;
}

function prioritizeAlternatives(card, shuffled) {
  const similar = candidate => card.partOfSpeech && candidate.partOfSpeech
    ? candidate.partOfSpeech === card.partOfSpeech
    : candidate.meaningKey.startsWith("to ") === card.meaningKey.startsWith("to ");
  const sameKind = [], other = [];
  for (const candidate of shuffled) {
    (similar(candidate) ? sameKind : other).push(candidate);
  }
  return [...sameKind, ...other];
}

export function phraseExample(phrase, target) {
  return [phrase.cue, phrase.kana, phrase.romaji, ...target.slice(1, 5), phrase.peeks];
}

export function preparedQuizChoices(id, prepared) {
  return shufflePracticeItems(prepared.map((meaning, index) => ({ id: index ? `alternative-${index}` : id, meaning })));
}

function englishQuestion(card, prepared, candidates) {
  const meanings = prepared ?? [card.meaning];
  if (!meanings.length) return null;
  const alternatives = meanings.length < quizKeys.length ? distractors(card, candidates, meanings) : [];
  if (meanings.length + alternatives.length !== quizKeys.length) return null;
  return { choices: prepared ? preparedQuizChoices(card.id, [...prepared, ...alternatives.map(choice => choice.meaning)])
    : shufflePracticeItems([card, ...alternatives]) };
}

function translationSpan(translation, meaning) {
  if (!meaning) return null;
  const key = answerKey(englishKey(meaning));
  if (!key) return null;
  const pattern = key.replace(/’/gu, "'").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replaceAll(" ", "\\s+");
  const matches = [...translation.replace(/’/gu, "'").matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"))];
  if (matches.length !== 1) return null;
  const [{ 0: match, index }] = matches;
  const start = Array.from(translation.slice(0, index)).length;
  return [start, start + Array.from(match).length];
}

function japaneseQuestion(phrase, word, card, candidates) {
  const [, hs, he, , , prepared] = phrase.targets[word];
  const meaning = prepared?.[0];
  if (!phrase.translation || !card.partOfSpeech || !meaning) return null;
  const englishTarget = translationSpan(phrase.translation, meaning);
  if (!englishTarget) return null;
  const [start, end] = englishTarget;
  if (phrase.targets.some(([, , , , , glosses], index) => {
    if (index === word) return false;
    const other = translationSpan(phrase.translation, glosses?.[0]);
    return other && start < other[1] && other[0] < end;
  })) return null;

  const kana = Array.from(phrase.kana).slice(hs, he).join("").trim();
  // A changed surface reading needs comparable forms for the other choices.
  if (!kana || hiraganaKey(kana) !== card.readingKey) return null;
  const writtenSpan = phrase.japaneseTargets?.[word];
  const written = phrase.japanese && writtenSpan
    ? Array.from(phrase.japanese).slice(...writtenSpan).join("").trim() : card.written;
  const romaji = toRomaji(kana);
  const answer = { id: card.id, written, kana, romaji };
  const choices = [answer];
  const glosses = new Set([...card.acceptable, englishKey(meaning)].map(answerKey));
  const cueWords = new Set([...phrase.targets, ...(phrase.peeks ?? [])].map(([id]) => id));
  const readings = new Set([card.readingKey]);
  const spellings = new Set([written, card.written].filter(Boolean));
  const romanizations = new Set([romaji]);
  for (const candidate of candidates) {
    if (cueWords.has(candidate.id) || readings.has(candidate.readingKey) || spellings.has(candidate.written)
      || [...candidate.acceptable].some(gloss => glosses.has(answerKey(gloss)))) continue;
    const candidateRomaji = toRomaji(candidate.kana);
    if (romanizations.has(candidateRomaji)) continue;
    choices.push({ ...candidate, romaji: candidateRomaji });
    readings.add(candidate.readingKey);
    if (candidate.written) spellings.add(candidate.written);
    romanizations.add(candidateRomaji);
    if (choices.length === quizKeys.length) break;
  }
  return choices.length === quizKeys.length ? { englishTarget, meaning, choices: shufflePracticeItems(choices) } : null;
}

export function nextPhraseQuestion(phrases, cards, phraseIndex = 0, wordIndex = 0, preferJapanese = false, fallbackCards = []) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const episode = shufflePracticeItems(cards);
  const fallback = shufflePracticeItems(fallbackCards);
  for (let line = phraseIndex; line < phrases.length; line++) {
    const phrase = phrases[line];
    for (let word = line === phraseIndex ? wordIndex : 0; word < phrase.targets.length; word++) {
      const target = phrase.targets[word];
      const [id, , , , , prepared] = target;
      const card = byId.get(id);
      if (!card) continue;
      const candidates = [...prioritizeAlternatives(card, episode), ...prioritizeAlternatives(card, fallback)];
      const question = (preferJapanese && japaneseQuestion(phrase, word, card, candidates))
        || englishQuestion(card, prepared, candidates)
        || (!preferJapanese && japaneseQuestion(phrase, word, card, candidates));
      if (question) return { card, phrase, line, word, example: phraseExample(phrase, target), ...question };
    }
  }
}

const reviewInterval = 2;
export function episodeQuestionFor(card, cards, exposed = () => false) {
  const example = card?.examples?.find(example => !exposed(example));
  if (!example) return undefined;
  const alternatives = distractors(card, prioritizeAlternatives(card, cards));
  if (alternatives.length === quizKeys.length - 1) {
    return { card, choices: shufflePracticeItems([card, ...alternatives]), example };
  }
}

export function nextEpisodeQuestion({ cards, fresh, next }, { turn, seen, retries, forward }, exposed = () => false) {
  let ready;
  let earliest;
  for (const retry of retries.values()) {
    const { question } = retry;
    const example = [question.example, ...(question.card.examples ?? [])].find(line => !exposed(line));
    if (!example) continue;
    const available = { ...retry, question: { ...question, example, review: true } };
    if (retry.after <= turn && (!ready || retry.correct < ready.correct)) ready = available;
    if (!earliest || retry.after < earliest.after) earliest = available;
  }
  if (ready && forward >= reviewInterval) return ready.question;

  const shuffled = shufflePracticeItems(cards);
  for (const card of fresh) {
    if (seen.has(card.id) || !card.examples?.some(example => !exposed(example))) continue;
    const question = episodeQuestionFor(card, shuffled, exposed);
    if (question) return question;
    if (next) return undefined;
  }
  if (next) return undefined;
  const retry = ready ?? earliest;
  return retry?.question ?? null;
}
