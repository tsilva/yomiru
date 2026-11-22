import assert from "node:assert/strict";
import test from "node:test";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { createPracticeReview, orderPracticeReview } from "../src/practice-review.mjs";
import { packPracticeCard } from "../src/practice-deck.mjs";
import { gradePracticeCard, isFirstRecallDue, nextPracticeReviewAt, practiceCards, presentedWords, presentPracticeCard } from "../src/vocabulary-practice.mjs";

const day = 86_400_000;
const [read, listen] = practiceCards([
  { id: "read", word: "読む", reading: "よむ", romaji: "yomu", meanings: ["to read"], count: 1 },
  { id: "listen", word: "聞く", reading: "きく", romaji: "kiku", meanings: ["to listen"], count: 1 },
]);
const source = (id, ...phrases) => ({ id, cards: [read, listen].map(packPracticeCard), phrases });
const phrase = (cue, meaning) => ({ cue, kana: "ほんをよんだ。", romaji: "Hon o yonda.",
  japanese: "本を読んだ。", japaneseTargets: [[2, 5]],
  targets: [["read", 3, 6, 6, 11, [meaning, "I wrote", "I listened", "I drew"]]] });
const learned = { id: read.id, readingKey: read.readingKey, meaningKey: read.meaningKey,
  halfLife: 2, updatedAt: 0, stage: 0, checks: [], reviewGap: day, version: 2 };

function reviewQuestions(sources, progress) {
  const review = createPracticeReview(progress);
  for (const item of sources) review.addSources([item]);
  return review.questions();
}

test("global review is revision-pinned to the full reviewed library", () => {
  const request = { mode: "practice-review", publication: "a".repeat(64) };
  assert.deepEqual(readPublicVocabularyQuery(request), { ...request, scope: "all" });
  const cursor = "tt1234567:1:2/c00003";
  assert.deepEqual(readPublicVocabularyQuery({ ...request, cursor }), { ...request, scope: "all", cursor });
  assert.equal(readPublicVocabularyQuery({ ...request, cursor: "tt1234567/cue" }), null);
  assert.equal(readPublicVocabularyQuery({ ...request, titles: "tt0112159:1:2" }), null);
  assert.equal(readPublicVocabularyQuery({ ...request, publication: "" }), null);
  assert.equal(readSelection({ ...request, scope: "all" }), null);
});

test("review orders missed, due, upcoming, and unscheduled words without filtering", () => {
  const missed = { id: "missed", halfLife: 0, updatedAt: 2,
    reviewContext: { meaning: "to write", correct: false } };
  const progress = new Map([["unseen", { id: "unseen", halfLife: 0 }], ["missed", missed],
    ["future", { ...learned, id: "future", dueAt: 2 * day }], [read.id, learned]]);
  const questions = [...progress.keys()].map(id => ({ card: { id } }));
  const ordered = () => orderPracticeReview(questions, progress).map(({ card }) => card.id);
  assert.deepEqual(ordered(), ["missed", read.id, "future", "unseen"]);
  progress.set("missed", { ...missed, dueAt: 3 * day });
  assert.deepEqual(ordered(), [read.id, "future", "missed", "unseen"]);
  assert.equal(nextPracticeReviewAt(progress.get("unseen")), null);
  assert.equal(nextPracticeReviewAt(missed), 0);
  assert.equal(nextPracticeReviewAt({ ...missed, dueAt: 2 * day }), 2 * day);
  assert.equal(nextPracticeReviewAt(learned), day);
  assert.equal(nextPracticeReviewAt(progress.get("future")), 2 * day);
});

test("review includes every matching practiced word, once per round, beyond twelve", () => {
  const cards = Array.from({ length: 15 }, (_, index) => ({ ...read, id: `read-${index}` }));
  const practiced = cards.slice(0, 14).map(card => ({ ...learned, id: card.id, dueAt: 2 * day }));
  const phrases = cards.map(card => {
    const question = phrase(`cue-${card.id}`, "read");
    question.targets[0][0] = card.id;
    return question;
  });
  const sources = [{ id: "first", cards: cards.map(packPracticeCard), phrases },
    { id: "second", cards: cards.map(packPracticeCard), phrases }];
  const questions = reviewQuestions(sources, practiced);
  assert.deepEqual(questions.map(({ card }) => card.id), practiced.map(({ id }) => id));
});

test("review prefers a different same-meaning episode and preserves the inflected span", () => {
  const practiced = { ...learned, reviewContext: { titleId: "episode-1", cue: "learned", meaning: "I read" } };
  const first = source("episode-1", phrase("learned", "I read"), phrase("alternate", "I read"));
  const other = { ...source("movie", phrase("wrong-sense", "I understood"), { ...phrase("new", "I read"), time: 0 }),
    title: { id: "movie", type: "movie", title: "Fixture Film" } };
  const [question] = reviewQuestions([first, other], [practiced]);
  assert.equal(question.titleId, "movie");
  assert.deepEqual(question.title, other.title);
  assert.equal(question.phrase.cue, "new");
  assert.equal(question.phrase.time, 0);
  assert.equal(question.choices.find(choice => choice.id === read.id).meaning, "I read");
  assert.deepEqual(new Set(question.choices.map(choice => choice.meaning)),
    new Set(["I read", "I wrote", "I listened", "I drew"]));
  assert.equal(question.card.id, read.id);
  assert.equal(question.example[1].slice(...question.example.slice(3, 5)), "よんだ");
  assert.equal(question.phrase.japanese.slice(...question.phrase.japaneseTargets[question.word]), "読んだ");
  assert.equal(reviewQuestions([first], [practiced])[0].phrase.cue, "alternate");
  assert.deepEqual(reviewQuestions([other], [{ ...practiced, reviewContext: { meaning: "I called" } }]), []);
});

test("legacy practice can review the canonical meaning and skips targets without four choices", () => {
  const unprepared = phrase("unreviewed", "read");
  unprepared.targets[0].pop();
  const incomplete = phrase("incomplete", "read");
  incomplete.targets[0][5].pop();
  const [question] = reviewQuestions([source("approved", unprepared, incomplete, phrase("reviewed", "Read."))], [learned]);
  assert.equal(question.phrase.cue, "reviewed");
});

test("a displayed but unanswered word enters Review and earns credit on its first correct answer", () => {
  const introduced = presentPracticeCard(read, undefined, "episode", 0).word;
  const progress = new Map([[read.id, introduced], [listen.id, { id: listen.id, halfLife: 0 }]]);
  assert.deepEqual([...presentedWords(progress).keys()], [read.id]);
  const contextual = source("episode-1", phrase("approved", "I read"), phrase("other-sense", "I understand"));
  const knownContext = { ...introduced, presentedContext: { meaning: "I understand" } };
  assert.deepEqual(reviewQuestions([contextual], [introduced]).map(({ phrase }) => phrase.cue), ["approved"]);
  assert.deepEqual(reviewQuestions([contextual], [knownContext]).map(({ phrase }) => phrase.cue), ["other-sense"]);

  const { word, event } = presentPracticeCard(read, introduced, "review", day);
  const grade = gradePracticeCard(word, event, { correct: true, spaced: true, choices: 4, review: true, at: day });
  assert.equal(grade.halfLife, 2);
  assert.equal(grade.dueAt, 2 * day);
});

test("choosing the meaning of a previously missed word starts its schedule", () => {
  const previous = { ...learned, halfLife: 0, reviewContext: { correct: false } };
  const { word, event } = presentPracticeCard(read, previous, "review", day);
  const rating = { spaced: true, choices: 4, review: true, at: day };
  const missed = gradePracticeCard(word, event, { ...rating, correct: false });
  assert.equal(missed.dueAt, 2 * day);
  assert.equal(isFirstRecallDue(missed, day), false);
  const learnedAgain = gradePracticeCard(word, event, { ...rating, correct: true });
  assert.equal(learnedAgain.halfLife, 2);
  assert.equal(learnedAgain.stage, 0);
  assert.equal(learnedAgain.dueAt, 2 * day);
});

test("repeat review before the scheduled date keeps the saved interval and mastery", () => {
  const previous = { ...learned, dueAt: 2 * day, lastSeenAt: day / 2 };
  const { word, event } = presentPracticeCard(read, previous, "repeat", day);
  const rating = { spaced: true, choices: 4, review: true, at: day };
  assert.equal(gradePracticeCard(word, event, { ...rating, correct: true }), word);
  assert.equal(gradePracticeCard(word, event, { ...rating, correct: false }), word);
  assert.equal(word.lastSeenAt, day);
});

test("four-choice review grades a due word and keeps the actual delay requirement", () => {
  const initial = { ...learned, lastSeenAt: 0 };
  const rating = { correct: true, spaced: true, choices: 4, review: true, at: day };
  const { word, event } = presentPracticeCard(read, initial, "review", day);
  assert.equal(gradePracticeCard(word, event, { ...rating, choices: 1 }), word);
  assert.equal(gradePracticeCard(word, event, { ...rating, correct: false }).halfLife, 1.3);
  const correct = gradePracticeCard(word, event, rating);
  assert.deepEqual(correct.checks, [{ correct: true, elapsed: day }]);
  assert.equal(correct.stage, 1);
  assert.equal(correct.dueAt, 4 * day);

  const recent = presentPracticeCard(read, { ...initial, lastSeenAt: day - 1000 }, "review", day);
  assert.equal(gradePracticeCard(recent.word, recent.event, rating).stage, 0);
});
