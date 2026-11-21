import assert from "node:assert/strict";
import test from "node:test";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { createPracticeReview, dueReviewWords } from "../src/practice-review.mjs";
import { packPracticeCard } from "../src/practice-deck.mjs";
import { gradePracticeCard, practiceCards, presentPracticeCard } from "../src/vocabulary-practice.mjs";

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

function reviewQuestions(sources, due) {
  const review = createPracticeReview(due);
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

test("review includes due practiced words and recently missed first answers", () => {
  const missed = { id: "missed", halfLife: 0, updatedAt: 2,
    reviewContext: { meaning: "to write", correct: false } };
  const progress = new Map([["unseen", { id: "unseen", halfLife: 0 }], ["missed", missed],
    ["future", { ...learned, id: "future", dueAt: 2 * day }], [read.id, learned]]);
  assert.deepEqual(dueReviewWords(progress, day).map(word => word.id), ["missed", read.id]);
});

test("review prefers a different same-meaning episode and preserves the inflected span", () => {
  const practiced = { ...learned, reviewContext: { titleId: "episode-1", cue: "learned", meaning: "I read" } };
  const first = source("episode-1", phrase("learned", "I read"), phrase("alternate", "I read"));
  const other = source("episode-2", phrase("wrong-sense", "I understood"), phrase("new", "I read"));
  const [question] = reviewQuestions([first, other], [practiced]);
  assert.equal(question.titleId, "episode-2");
  assert.equal(question.phrase.cue, "new");
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

test("choosing the meaning of a previously missed word starts its schedule", () => {
  const previous = { ...learned, halfLife: 0, reviewContext: { correct: false } };
  const { word, event } = presentPracticeCard(read, previous, "review", day);
  const rating = { spaced: true, choices: 4, review: true, at: day };
  const missed = gradePracticeCard(word, event, { ...rating, correct: false });
  assert.equal(missed.dueAt, 2 * day);
  assert.equal(dueReviewWords(new Map([[word.id, missed]]), day).length, 0);
  const learnedAgain = gradePracticeCard(word, event, { ...rating, correct: true });
  assert.equal(learnedAgain.halfLife, 2);
  assert.equal(learnedAgain.stage, 0);
  assert.equal(learnedAgain.dueAt, 2 * day);
});

test("four-choice review grades a due word and keeps the actual delay requirement", () => {
  const initial = { ...learned, lastSeenAt: 0 };
  const rating = { correct: true, spaced: true, choices: 4, review: true, at: day };
  const { word, event } = presentPracticeCard(read, initial, "review", day);
  assert.equal(gradePracticeCard(word, event, { ...rating, choices: 3 }), word);
  assert.equal(gradePracticeCard(word, event, { ...rating, correct: false }).halfLife, 1.3);
  const correct = gradePracticeCard(word, event, rating);
  assert.deepEqual(correct.checks, [{ correct: true, elapsed: day }]);
  assert.equal(correct.stage, 1);
  assert.equal(correct.dueAt, 4 * day);

  const recent = presentPracticeCard(read, { ...initial, lastSeenAt: day - 1000 }, "review", day);
  assert.equal(gradePracticeCard(recent.word, recent.event, rating).stage, 0);
});
