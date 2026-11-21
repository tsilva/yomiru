import assert from "node:assert/strict";
import test from "node:test";
import { readPublicVocabularyQuery, readSelection } from "../api/vocabulary-selection.mjs";
import { buildPracticeReview, dueReviewWords } from "../src/practice-review.mjs";
import { packPracticeCard } from "../src/practice-deck.mjs";
import { gradePracticeCard, practiceCards, presentPracticeCard } from "../src/vocabulary-practice.mjs";

const day = 86_400_000;
const [read, listen] = practiceCards([
  { id: "read", word: "読む", reading: "よむ", romaji: "yomu", meanings: ["to read"], count: 1 },
  { id: "listen", word: "聞く", reading: "きく", romaji: "kiku", meanings: ["to listen"], count: 1 },
]);
const source = (id, ...phrases) => ({ id, cards: [read, listen].map(packPracticeCard), phrases });
const phrase = (cue, meaning) => ({ cue, kana: "ほんをよんだ。", romaji: "Hon o yonda.",
  japanese: "本を読んだ。", japaneseTargets: [[2, 5]], targets: [["read", 3, 6, 6, 11, [meaning, "I wrote"]]] });
const learned = { id: read.id, readingKey: read.readingKey, meaningKey: read.meaningKey,
  halfLife: 2, updatedAt: 0, stage: 0, checks: [], reviewGap: day, version: 2 };

test("global review is revision-pinned to the approved source", () => {
  const request = { mode: "practice-review", publication: "a".repeat(64) };
  assert.deepEqual(readPublicVocabularyQuery(request).episodes, [{ id: "tt0112159:1:1" }]);
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
  const review = buildPracticeReview([first, other], [practiced]);
  const [question] = review.questions;
  assert.equal(question.titleId, "episode-2");
  assert.equal(question.phrase.cue, "new");
  assert.equal(question.meaning, "I read");
  assert.equal(question.card.id, read.id);
  assert.equal(question.example[1].slice(...question.example.slice(3, 5)), "よんだ");
  assert.equal(question.phrase.japanese.slice(...question.phrase.japaneseTargets[question.word]), "読んだ");
  assert.equal(buildPracticeReview([first], [practiced]).questions[0].phrase.cue, "alternate");
  assert.equal(buildPracticeReview([other], [{ ...practiced, reviewContext: { meaning: "I called" } }]).missing, 1);
});

test("legacy practice can review the canonical meaning and ignores unprepared targets", () => {
  const unprepared = phrase("unreviewed", "read");
  unprepared.targets[0].pop();
  const result = buildPracticeReview([source("approved", unprepared, phrase("reviewed", "Read."))], [learned]);
  assert.equal(result.questions[0].phrase.cue, "reviewed");
  assert.equal(result.missing, 0);
});

test("recalling a previously missed word starts its schedule without awarding a delayed stage", () => {
  const previous = { ...learned, halfLife: 0, reviewContext: { correct: false } };
  const { word, event } = presentPracticeCard(read, previous, "review", day);
  const rating = { spaced: true, recall: true, review: true, at: day };
  const missed = gradePracticeCard(word, event, { ...rating, correct: false });
  assert.equal(missed.dueAt, 2 * day);
  assert.equal(dueReviewWords(new Map([[word.id, missed]]), day).length, 0);
  const learnedAgain = gradePracticeCard(word, event, { ...rating, correct: true });
  assert.equal(learnedAgain.halfLife, 2);
  assert.equal(learnedAgain.stage, 0);
  assert.equal(learnedAgain.dueAt, 2 * day);
});
