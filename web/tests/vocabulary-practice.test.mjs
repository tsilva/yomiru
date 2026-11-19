import assert from "node:assert/strict";
import test from "node:test";
import { gradePracticeCard, masteryAt, nextPracticeCards, practiceCards, presentPracticeCard,
  selectionPracticeStats } from "../src/vocabulary-practice.mjs";

const day = 86_400_000;
const raw = (id, reading, meaning, count = 1) => ({ id, word: reading, reading, romaji: "kana",
  meanings: meaning ? [meaning] : [], count });
const shared = raw("shared", "みる", "to see", 30);
const [card] = practiceCards([shared]);

function review(previous, at, { correct = true, choices = 4, spaced = true, answer = card } = {}) {
  const { word, event } = presentPracticeCard(answer, previous, `appearance-${at}`, at);
  return gradePracticeCard(word, event, { correct, choices, spaced, at, sessionStartedAt: at });
}

test("shared mastery survives a selection change and overlaps count once", () => {
  const eva = practiceCards([shared, raw("eva", "まつ", "to wait")]);
  const onePiece = practiceCards([shared, raw("one-piece", "ふね", "ship"), raw("missing", "なに", "")]);
  const both = practiceCards([shared, raw("eva", "まつ", "to wait"), shared, raw("one-piece", "ふね", "ship")]);
  let word;
  for (const elapsedDays of [0, 1, 4, 11, 25, 55]) word = review(word, elapsedDays * day);
  const progress = new Map([[word.id, word]]);
  const now = 55 * day;
  assert.deepEqual(selectionPracticeStats(eva, progress, now), { mastery: 50, mastered: 1, total: 2 });
  assert.deepEqual(selectionPracticeStats(onePiece, progress, now), { mastery: 50, mastered: 1, total: 2 });
  assert.deepEqual(selectionPracticeStats(both, progress, now), { mastery: 100 / 3, mastered: 1, total: 3 });
  assert.deepEqual(selectionPracticeStats([], progress, now), { mastery: 0, mastered: 0, total: 0 });
  const decayed = selectionPracticeStats(both, progress, now + day);
  assert.ok(decayed.mastery < 100 / 3);
  assert.equal(decayed.mastered, 1);
  const changed = practiceCards([raw("shared", "みる", "to look at")]);
  assert.equal(selectionPracticeStats(changed, progress, now).mastered, 0);
});

test("fresh matches raise mastery immediately while forced pairs and fast repeats do not", () => {
  let word = review(undefined, day);
  assert.equal(word.score, 35);
  word = review(word, day, { choices: 1 });
  assert.equal(word.score, 35);
  word = review(word, day, { spaced: false });
  assert.equal(word.score, 35);
  word = review(word, day);
  assert.equal(word.score, 70);
  word = review(word, day);
  assert.equal(word.score, 100);
  assert.equal(word.halfLife, 2);
  const stats = selectionPracticeStats([card], new Map([[word.id, word]]), day);
  assert.deepEqual(stats, { mastery: 100, mastered: 0, total: 1 });
  assert.equal(Math.round(masteryAt(word, 2 * day)), 71);
});

test("delayed recognition strengthens retention, and a lapse keeps prior evidence", () => {
  let word = review(undefined, 0);
  word = review(word, day);
  assert.equal(word.halfLife, 5);
  assert.equal(word.score, 100);
  word = review(word, 4 * day);
  word = review(word, 11 * day);
  word = review(word, 25 * day, { correct: false });
  assert.equal(word.halfLife, 25);
  assert.equal(word.checks.length, 4);
  word = review(word, 25 * day + 1);
  assert.equal(word.halfLife, 25);
  word = review(word, 55 * day + 1);
  assert.equal(word.halfLife, 62.5);
  assert.equal(word.stage, 5);
  assert.deepEqual(word.checks.map(check => check.correct), [true, true, true, false, true]);
});

test("a different definition gets a fresh check without affecting other words", () => {
  const word = review(review(undefined, 0), day);
  const corrected = practiceCards([raw("shared", "みる", "to look at")])[0];
  const next = review(word, day + 1, { answer: corrected });
  assert.equal(next.id, word.id);
  assert.equal(next.halfLife, 2);
  assert.deepEqual(next.checks, []);
  assert.equal(next.score, 100);
});

test("a board excludes homophones and overlapping English answers", () => {
  const cards = practiceCards([shared, raw("homophone", "みる", "to inspect", 20),
    { ...raw("overlap", "みえる", "to appear", 10), meanings: ["to appear", "to see"] },
    raw("distinct", "いく", "to go"), { ...raw("loanword", "ちゃんす", "chance"), word: "チャンス" }]);
  const picked = nextPracticeCards(cards, new Map(), [], new Map(), 0, 4, 0, true);
  assert.deepEqual(picked.map(item => item.id), ["shared", "distinct", "loanword"]);
  assert.equal(picked[2].kana, "チャンス");
});

test("a rolling refill brings back a correct word sooner than a missed word", () => {
  const cards = practiceCards([shared, raw("missed", "まつ", "to wait", 40), raw("new", "ふね", "ship")]);
  const lastPlayed = new Map([["shared", { turn: 2, correct: true }], ["missed", { turn: 1, correct: false }]]);
  const refill = turn => nextPracticeCards(cards, new Map(), [], lastPlayed, turn, 1, 0, false)[0].id;
  assert.equal(refill(4), "shared");
  lastPlayed.set("shared", { turn: 6, correct: true });
  assert.equal(refill(7), "missed");
});

test("opening boards and early refills favor content words over frequent grammar", () => {
  const cards = practiceCards([{ ...raw("particle", "の", "possessive marker", 120), pos: "助詞/格助詞" },
    { ...raw("auxiliary", "だ", "copula", 140), pos: "助動詞" },
    { ...raw("interjection", "あっ", "ah", 90), pos: "感動詞/一般" },
    raw("common", "する", "to do", 40), raw("wait", "まつ", "to wait", 18),
    raw("rare", "ふね", "ship", 15), raw("sea", "うみ", "sea", 5)]);
  const particle = cards[0];
  const opening = (progress, now) => nextPracticeCards(cards, progress, [], new Map(), 0, 4, now, true).map(item => item.id);
  assert.deepEqual(opening(new Map(), 0), ["common", "wait", "rare", "sea"]);
  const progress = new Map([[particle.id, review(undefined, 0, { answer: particle })]]);
  assert.deepEqual(opening(progress, day), ["common", "wait", "rare", "particle"]);
  const active = cards.filter(item => ["common", "wait", "rare"].includes(item.id));
  const refill = turn => nextPracticeCards(cards, new Map(), active, new Map(), turn, 1, 0, false)[0].id;
  assert.equal(refill(1), "sea");
  assert.equal(refill(4), "auxiliary");
});
