import { shufflePracticeItems } from "./vocabulary-practice.mjs";

export const quizKeys = ["1", "2", "3", "4"];

export function quizContextSpans(example, targetId) {
  const [, , , kanaStart, kanaEnd, romajiStart, romajiEnd, peeks] = example;
  const target = { kana: [kanaStart, kanaEnd], romaji: [romajiStart, romajiEnd] };
  const words = (peeks ?? []).flatMap(([id, meaning, hs, he, rs, re]) => (
    id === targetId || (hs < kanaEnd && he > kanaStart) || (rs < romajiEnd && re > romajiStart)
      ? [] : [{ meaning, kana: [hs, he], romaji: [rs, re] }]
  ));
  return [...words, target].sort((a, b) => a.kana[0] - b.kana[0]);
}

function answerKey(meaningKey) {
  return meaningKey.replace(/^to /, "");
}

function distractors(prompt, cards) {
  const used = new Set([...prompt.acceptable].map(answerKey));
  used.add(answerKey(prompt.meaningKey));
  return cards.filter(card => {
    const key = answerKey(card.meaningKey);
    if (card.id === prompt.id || card.readingKey === prompt.readingKey
      || card.romaji === prompt.romaji || used.has(key)) return false;
    used.add(key);
    return true;
  }).slice(0, quizKeys.length - 1);
}

function quizAlternatives(card, shuffled) {
  const similar = candidate => card.partOfSpeech && candidate.partOfSpeech
    ? candidate.partOfSpeech === card.partOfSpeech
    : candidate.meaningKey.startsWith("to ") === card.meaningKey.startsWith("to ");
  const sameKind = [], other = [];
  for (const candidate of shuffled) {
    (similar(candidate) ? sameKind : other).push(candidate);
  }
  return distractors(card, [...sameKind, ...other]);
}

export function nextPhraseQuestion(phrases, cards, phraseIndex = 0, wordIndex = 0) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const shuffled = shufflePracticeItems(cards);
  for (let line = phraseIndex; line < phrases.length; line++) {
    const phrase = phrases[line];
    for (let word = line === phraseIndex ? wordIndex : 0; word < phrase.targets.length; word++) {
      const [id, ...spans] = phrase.targets[word];
      const card = byId.get(id);
      if (!card) continue;
      const alternatives = quizAlternatives(card, shuffled);
      if (!alternatives.length) continue;
      return { card, phrase, line, word, choices: shufflePracticeItems([card, ...alternatives]),
        example: [phrase.cue, phrase.kana, phrase.romaji, ...spans, phrase.peeks] };
    }
  }
}

const reviewInterval = 2;
export function episodeQuestionFor(card, cards, exposed = () => false) {
  const example = card?.examples?.find(example => !exposed(example));
  if (!example) return undefined;
  const alternatives = quizAlternatives(card, cards);
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
