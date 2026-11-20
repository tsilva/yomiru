import { practiceMembership } from "./practice-deck.mjs";
import { masteryAt, nextPracticeCards, shufflePracticeItems } from "./vocabulary-practice.mjs";

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

export function nextQuizQuestion(cards, progress, lastPlayed, turn, now) {
  const shuffled = shufflePracticeItems(cards);
  const choicesById = new Map();
  const eligible = cards.filter(card => {
    if (!card.examples?.length) return false;
    const alternatives = quizAlternatives(card, shuffled);
    if (alternatives.length !== quizKeys.length - 1) return false;
    choicesById.set(card.id, alternatives);
    return true;
  });
  const freshPrompts = eligible.filter(card => lastPlayed.get(card.id)?.turn !== turn);
  const prompts = freshPrompts.length ? freshPrompts : eligible;
  const [card] = nextPracticeCards(prompts, progress, [], lastPlayed, turn, 1, now, turn === 0 || turn % 4 === 0);
  if (!card) return undefined;
  const previousCue = lastPlayed.get(card.id)?.cue;
  const fresh = card.examples.filter(([cue]) => cue !== previousCue);
  const pool = fresh.length ? fresh : card.examples;
  const example = pool[Math.floor(Math.random() * pool.length)];
  return { card, choices: shufflePracticeItems([card, ...choicesById.get(card.id)]), example };
}

const reviewInterval = 2;
const retryGap = 2;

export function episodeCueTime({ source, cues }, example) {
  const [revision, cue] = example?.[0].split(":") ?? [];
  return revision === source ? cues[cue] : undefined;
}

export function episodeStopAt(stops, time) {
  const next = stops.findIndex(([start]) => start >= time);
  if (next <= 0) return next === 0 ? stops[0] : stops.at(-1);
  const before = stops[next - 1];
  const after = stops[next];
  return time - before[0] <= after[0] - time ? before : after;
}

export function episodeQuestionFor(card, cards) {
  const example = card?.examples?.[0];
  if (!example) return undefined;
  const alternatives = quizAlternatives(card, cards);
  if (alternatives.length === quizKeys.length - 1) {
    return { card, choices: shufflePracticeItems([card, ...alternatives]), example };
  }
}

export function nextEpisodeQuestion({ cards, fresh, next }, { turn, seen, retries, forward }) {
  let ready;
  let earliest;
  for (const retry of retries.values()) {
    if (retry.after <= turn && (!ready || retry.correct < ready.correct)) ready = retry;
    if (!earliest || retry.after < earliest.after) earliest = retry;
  }
  if (ready && forward >= reviewInterval) return { ...ready.question, review: true };

  const shuffled = shufflePracticeItems(cards);
  for (const card of fresh) {
    if (!card.examples?.length || seen.has(card.id)) continue;
    const question = episodeQuestionFor(card, shuffled);
    if (question) return question;
    if (next) return undefined;
  }
  if (next) return undefined;
  const retry = ready ?? earliest;
  return retry ? { ...retry.question, review: true } : null;
}

export function recordEpisodeAnswer(session, question, clean, progress, now) {
  const { card, review, choices, example } = question;
  if (review) session.forward = 0;
  else {
    session.seen.add(card.id);
    session.forward++;
  }
  const prior = session.retries.get(card.id);
  const word = progress.get(card.id);
  if (clean && !prior && !word?.needsVerification && masteryAt(word, now) >= 55
    && practiceMembership(card, word.readingKey, word.meaningKey) === "2") return;
  const correct = clean ? (prior?.correct ?? 0) + 1 : 0;
  if (correct >= 2) {
    session.retries.delete(card.id);
    return;
  }
  session.retries.delete(card.id);
  session.retries.set(card.id, { after: session.turn + retryGap, correct,
    question: { card, example, choices: shufflePracticeItems(choices) } });
}
