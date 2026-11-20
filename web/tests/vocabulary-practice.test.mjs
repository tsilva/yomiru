import assert from "node:assert/strict";
import test from "node:test";
import { gradePracticeCard, masteryAt, nextPracticeCards, practiceCards, presentPracticeCard,
  selectionPracticeStats } from "../src/vocabulary-practice.mjs";
import { packPracticeCard, toPracticeCard } from "../src/practice-deck.mjs";
import { nextEpisodeQuestion, nextQuizQuestion, recordEpisodeAnswer } from "../src/vocabulary-quiz.mjs";
import { masteryForWords, selectionMasteryWords } from "../src/library-mastery.mjs";

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

test("library mastery reuses cached titles and averages unique playable words", () => {
  const entries = new Map([
    ["title:one", ["shared", "first"]],
    ["title:two", ["shared", "second"]],
    ["selection:all", ["shared", "first", "second", "other"]],
  ]);
  const scores = new Map([["shared", 85]]);
  assert.equal(masteryForWords(selectionMasteryWords(entries, ["one"]), scores), 42.5);
  assert.equal(masteryForWords(selectionMasteryWords(entries, ["one", "two"]), scores), 85 / 3);
  assert.equal(masteryForWords(selectionMasteryWords(entries, []), scores), 85 / 4);
  assert.equal(selectionMasteryWords(entries, ["one", "unloaded"]), undefined);
  assert.equal(masteryForWords([], scores), null);
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

test("a missed word gets the next compatible refill after four other attempts", () => {
  const cards = practiceCards([shared, raw("missed", "まつ", "to wait"),
    raw("new", "ふね", "ship", 100), raw("homophone", "まつ", "pine")]);
  const [active, missed, , homophone] = cards;
  const lastPlayed = new Map([[missed.id, { turn: 5, correct: false }]]);
  const refill = (turn, board = [active]) => nextPracticeCards(cards, new Map(), board, lastPlayed, turn, 1, 0, false)
    .map(item => item.id);
  for (const turn of [5, 6, 7, 8]) assert.deepEqual(refill(turn), ["new"]);
  assert.deepEqual(refill(9, [active, homophone]), ["new"]);
  assert.deepEqual(refill(9), ["missed"]);
});

test("a two-word board skips the immediate miss and refills both gaps after another attempt", () => {
  const cards = practiceCards([shared, raw("missed", "まつ", "to wait")]);
  const [remaining, missed] = cards;
  const lastPlayed = new Map([[missed.id, { turn: 1, correct: false }]]);
  assert.deepEqual(nextPracticeCards(cards, new Map(), [remaining], lastPlayed, 1, 1, 0, false), []);
  assert.deepEqual(nextPracticeCards(cards, new Map(), [], lastPlayed, 1, 4, 0, true), [remaining]);
  lastPlayed.set(remaining.id, { turn: 2, correct: true });
  assert.deepEqual(nextPracticeCards(cards, new Map(), [], lastPlayed, 2, 4, 0, false), [remaining, missed]);
});

test("opening boards and early refills favor content words over frequent grammar", () => {
  const cards = practiceCards([{ ...raw("particle", "の", "possessive marker", 120), pos: "助詞/格助詞" },
    { ...raw("auxiliary", "だ", "copula", 140), pos: "助動詞" },
    { ...raw("interjection", "あっ", "ah", 90), pos: "感動詞/一般" },
    raw("common", "する", "to do", 40), raw("wait", "まつ", "to wait", 18),
    raw("rare", "ふね", "ship", 15), raw("sea", "うみ", "sea", 5)]);
  assert.equal(cards.some(card => card.id === "particle"), false);
  const auxiliary = cards.find(card => card.id === "auxiliary");
  const opening = (progress, now) => nextPracticeCards(cards, progress, [], new Map(), 0, 4, now, true).map(item => item.id);
  assert.deepEqual(opening(new Map(), 0), ["common", "wait", "rare", "sea"]);
  const progress = new Map([[auxiliary.id, review(undefined, 0, { answer: auxiliary })]]);
  assert.deepEqual(opening(progress, day), ["common", "wait", "rare", "auxiliary"]);
  const active = cards.filter(item => ["common", "wait", "rare"].includes(item.id));
  const refill = turn => nextPracticeCards(cards, new Map(), active, new Map(), turn, 1, 0, false)[0].id;
  assert.equal(refill(1), "sea");
  assert.equal(refill(4), "auxiliary");
});

const quizWord = (id, kana, romaji, meaning, count, pos = "動詞") =>
  ({ ...raw(id, kana, meaning, count), romaji, pos });

test("episode practice advances in subtitle order and returns to weak words without rewinding", () => {
  const cards = practiceCards([
    quizWord("wait", "まつ", "matsu", "to wait", 1), quizWord("carry", "はこぶ", "hakobu", "to carry", 15),
    quizWord("change", "かえる", "kaeru", "to change", 20), quizWord("return", "もどる", "modoru", "to return", 40),
  ]);
  const example = ["c00001", "すこしまつ。", "Sukoshi matsu.", 3, 5, 8, 13];
  cards[0].examples = [example];
  const progress = new Map(cards.slice(2).map(card => [card.id, {
    score: 90, updatedAt: 0, halfLife: 2, readingKey: card.readingKey, meaningKey: card.meaningKey,
  }]));
  const session = { turn: 0, seen: new Set(), retries: new Map(), forward: 0 };
  const deck = { cards, fresh: cards, next: null };
  const answer = (id, correct, retry = false) => {
    const question = nextEpisodeQuestion(deck, session);
    assert.equal(question.card.id, id);
    assert.equal(Boolean(question.review), retry);
    if (id === "wait") assert.equal(question.example, example);
    session.turn++;
    recordEpisodeAnswer(session, question, correct, progress, 0);
  };
  answer("wait", false);
  answer("carry", true);
  answer("change", true);
  answer("wait", true, true);
  answer("return", true);
  answer("carry", true, true);
  answer("wait", true, true);
  assert.equal(nextEpisodeQuestion(deck, session), null);
});

test("episode practice waits for more choices before skipping an earlier word", () => {
  const cards = practiceCards([
    quizWord("wait", "まつ", "matsu", "to wait", 1), quizWord("carry", "はこぶ", "hakobu", "to carry", 1),
    quizWord("change", "かえる", "kaeru", "to change", 1), quizWord("return", "もどる", "modoru", "to return", 1),
  ]);
  const session = { turn: 0, seen: new Set(), retries: new Map(), forward: 0 };
  assert.equal(nextEpisodeQuestion({ cards: cards.slice(0, 3), fresh: cards.slice(0, 3), next: [1, "change"] }, session), undefined);
  assert.equal(nextEpisodeQuestion({ cards, fresh: cards, next: null }, session).card.id, "wait");
});

test("a quiz presents four distinct choices and prefers valid distractors of the same part of speech", () => {
  const prompt = quizWord("choose", "えらぶ", "erabu", "to choose", 100);
  const cards = practiceCards([
    { ...prompt, meanings: ["to choose", "to select"] },
    quizWord("select", "えりぬく", "erinuku", "select", 20),
    quizWord("homophone", "えらぶ", "erabu", "to publish", 20),
    quizWord("carry", "はこぶ", "hakobu", "to carry", 3),
    quizWord("change", "かえる", "kaeru", "to change", 2),
    quizWord("return", "もどる", "modoru", "to return", 1),
    quizWord("ship", "ふね", "fune", "ship", 20, "名詞"),
  ]).map(card => toPracticeCard(packPracticeCard(card)));
  const question = nextQuizQuestion(cards, new Map(), new Map(), 0, 0);
  assert.equal(question.card.id, "choose");
  assert.equal(question.choices.length, 4);
  assert.deepEqual(new Set(question.choices.map(choice => choice.id)), new Set(["choose", "carry", "change", "return"]));
  assert.equal(nextQuizQuestion(cards.slice(0, 3), new Map(), new Map(), 0, 0), undefined);
});

test("particles are ineligible even when marked due or needed for four choices", () => {
  const cards = practiceCards([
    quizWord("ship", "ふね", "fune", "ship", 100, "名詞"),
    quizWord("topic", "は", "wa", "topic marker", 800, "助詞/係助詞"),
    quizWord("island", "しま", "shima", "island", 20, "名詞"),
    quizWord("walk", "あるく", "aruku", "to walk", 10),
    quizWord("blue", "あおい", "aoi", "blue", 5, "形容詞"),
  ]);
  const progress = new Map([["topic", { id: "topic", needsVerification: true }]]);
  const attempts = new Map([["topic", { turn: 1, correct: false }]]);
  for (const turn of [0, 11, 12]) {
    const question = nextQuizQuestion(cards, progress, attempts, turn, 0);
    assert.deepEqual(new Set(question.choices.map(choice => choice.id)), new Set(["ship", "island", "walk", "blue"]));
  }
  assert.equal(nextQuizQuestion(cards.slice(0, 3), progress, attempts, 11, 0), undefined);
});

test("a quiz sends a missed word to a later question", () => {
  const cards = practiceCards([
    quizWord("choose", "えらぶ", "erabu", "to choose", 100),
    quizWord("carry", "はこぶ", "hakobu", "to carry", 3),
    quizWord("change", "かえる", "kaeru", "to change", 2),
    quizWord("return", "もどる", "modoru", "to return", 1),
  ]);
  const attempts = new Map([["choose", { turn: 1, correct: false }]]);
  assert.notEqual(nextQuizQuestion(cards, new Map(), attempts, 1, 0).card.id, "choose");
  assert.equal(nextQuizQuestion(cards, new Map(), attempts, 5, 0).card.id, "choose");
});
