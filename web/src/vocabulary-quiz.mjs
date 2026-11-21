import { shufflePracticeItems } from "./vocabulary-practice.mjs";

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

export function phraseExample(phrase, target) {
  return [phrase.cue, phrase.kana, phrase.romaji, ...target.slice(1, 5), phrase.peeks];
}

export function preparedQuizChoices(id, prepared) {
  return shufflePracticeItems(prepared.map((meaning, index) => ({ id: index ? `alternative-${index}` : id, meaning })));
}

export function nextPhraseQuestion(phrases, cards, phraseIndex = 0, wordIndex = 0) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const shuffled = shufflePracticeItems(cards);
  for (let line = phraseIndex; line < phrases.length; line++) {
    const phrase = phrases[line];
    for (let word = line === phraseIndex ? wordIndex : 0; word < phrase.targets.length; word++) {
      const target = phrase.targets[word];
      const [id, , , , , prepared] = target;
      const card = byId.get(id);
      if (!card) continue;
      const choices = prepared
        ? preparedQuizChoices(id, prepared)
        : shufflePracticeItems([card, ...quizAlternatives(card, shuffled)]);
      if (choices.length < 2) continue;
      return { card, phrase, line, word, choices,
        example: phraseExample(phrase, target) };
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
