import { nextPracticeCards, shufflePracticeItems } from "./vocabulary-practice.mjs";

export const quizKeys = ["1", "2", "3", "4"];

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

export function nextQuizQuestion(cards, progress, lastPlayed, turn, now) {
  const shuffled = shufflePracticeItems(cards);
  const choicesById = new Map();
  const eligible = cards.filter(card => {
    const similar = candidate => card.partOfSpeech && candidate.partOfSpeech
      ? candidate.partOfSpeech === card.partOfSpeech
      : candidate.meaningKey.startsWith("to ") === card.meaningKey.startsWith("to ");
    const sameKind = [], other = [];
    for (const candidate of shuffled) (similar(candidate) ? sameKind : other).push(candidate);
    const alternatives = distractors(card, [...sameKind, ...other]);
    if (alternatives.length !== quizKeys.length - 1) return false;
    choicesById.set(card.id, alternatives);
    return true;
  });
  const [card] = nextPracticeCards(eligible, progress, [], lastPlayed, turn, 1, now, turn === 0 || turn % 4 === 0);
  return card && { card, choices: shufflePracticeItems([card, ...choicesById.get(card.id)]) };
}
