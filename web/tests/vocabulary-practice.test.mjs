import assert from "node:assert/strict";
import test from "node:test";
import { gradePracticeCard, markPracticeTaught, masteryAt, nextPracticeCards, practiceCards, presentPracticeCard,
  recallReviewDue, selectionPracticeStats, upgradePracticeProgress } from "../src/vocabulary-practice.mjs";
import { createSubtitlePractice, episodeStopAt, nextPhraseQuestion } from "../src/vocabulary-quiz.mjs";
import { deckPracticeStats } from "../src/practice-deck.mjs";
import { reviewedVocabularyProgress, vocabularyProgressForWords } from "../src/library-mastery.mjs";

const day = 86_400_000;
const raw = (id, reading, meaning, count = 1) => ({ id, word: reading, reading, romaji: "kana",
  meanings: meaning ? [meaning] : [], count });
const shared = raw("shared", "みる", "to see", 30);
const [card] = practiceCards([shared]);

test("episode seeking snaps to the nearest subtitle and includes zero and the last stop", () => {
  const stops = [[0, "c00001", null], [15_000, "c00002", [1, "c00001"]],
    [35_000, "c00003", [1, "c00002"]]];
  assert.equal(episodeStopAt(stops, 0), stops[0]);
  assert.equal(episodeStopAt(stops, 7_500), stops[0]);
  assert.equal(episodeStopAt(stops, 7_501), stops[1]);
  assert.equal(episodeStopAt(stops, 90_000), stops[2]);
});

function review(previous, at, { correct = true, choices = 4, spaced = true, delayed = false, answer = card } = {}) {
  const { word, event } = presentPracticeCard(answer, previous, `appearance-${at}`, at);
  return gradePracticeCard(word, event, { correct, choices, spaced, review: delayed, at });
}

test("shared mastery survives a selection change and overlaps count once", () => {
  const eva = practiceCards([shared, raw("eva", "まつ", "to wait")]);
  const onePiece = practiceCards([shared, raw("one-piece", "ふね", "ship"), raw("missing", "なに", "")]);
  const both = practiceCards([shared, raw("eva", "まつ", "to wait"), shared, raw("one-piece", "ふね", "ship")]);
  let word;
  for (const elapsedDays of [0, 1, 4, 11, 25, 55]) word = review(word, elapsedDays * day, { delayed: elapsedDays > 0 });
  const progress = new Map([[word.id, word]]);
  const now = 55 * day;
  const score = masteryAt(word, now);
  assert.deepEqual(selectionPracticeStats(eva, progress, now), { mastery: score / 2, introduced: 1, mastered: 1, total: 2 });
  assert.deepEqual(selectionPracticeStats(onePiece, progress, now), { mastery: score / 2, introduced: 1, mastered: 1, total: 2 });
  assert.deepEqual(selectionPracticeStats(both, progress, now), { mastery: score / 3, introduced: 1, mastered: 1, total: 3 });
  assert.deepEqual(selectionPracticeStats([], progress, now), { mastery: 0, introduced: 0, mastered: 0, total: 0 });
  const decayed = selectionPracticeStats(both, progress, now + day);
  assert.ok(decayed.mastery < 100 / 3);
  assert.equal(decayed.mastered, 1);
  const changed = practiceCards([raw("shared", "みる", "to look at")]);
  assert.equal(selectionPracticeStats(changed, progress, now).mastered, 0);
});

test("vocabulary coverage includes unanswered appearances and counts mastery inside introduced words", () => {
  const words = new Set(["unseen", "shown", "known", "shared"]);
  const progress = new Map([
    ["shown", { lastSeenAt: 0, halfLife: 0, stage: 0 }],
    ["known", { halfLife: 16, stage: 4, updatedAt: 0 }],
    ["shared", { halfLife: 32, stage: 5, updatedAt: 0 }],
    ["outside", { halfLife: 32, stage: 5, updatedAt: 0 }],
  ]);
  assert.deepEqual(vocabularyProgressForWords(words, progress), { total: 4, introduced: 3, mastered: 1 });
  const membership = new Map([["shown", "2"], ["known", "2"], ["shared", "2"], ["outside", "0"]]);
  const { mastery, ...deck } = deckPracticeStats(4, membership, progress, 0);
  assert.ok(mastery > 0);
  assert.deepEqual(deck, vocabularyProgressForWords(words, progress));
  membership.set("shared", "1");
  const revised = deckPracticeStats(4, membership, progress, 0);
  assert.equal(revised.introduced, 3);
  assert.equal(revised.mastered, 0);
});

test("reviewed progress counts each word once and credits mastery only for a current definition", () => {
  const first = [["shared", "ねこ", ["cat"]], ["new", "いぬ", ["dog"]]];
  const second = [["shared", "ねこ", ["kitty"]], ["extra", "さかな", ["fish"]]];
  const progress = new Map([
    ["shared", { readingKey: "ねこ", meaningKey: "kitty", lastSeenAt: 0, stage: 5 }],
    ["extra", { readingKey: "さかな", meaningKey: "fish", lastSeenAt: 0, stage: 0 }],
    ["withdrawn", { lastSeenAt: 0, stage: 5 }],
  ]);
  assert.deepEqual(reviewedVocabularyProgress(first, progress), { introduced: 1, mastered: 0, total: 2 });
  assert.deepEqual(reviewedVocabularyProgress(second, progress), { introduced: 2, mastered: 1, total: 2 });
  assert.deepEqual(reviewedVocabularyProgress([...first, ...second], progress), { introduced: 2, mastered: 1, total: 3 });
});

test("first recognition seeds the curve while repeats cannot inflate or refresh it", () => {
  for (const setup of [{ choices: 1 }, { spaced: false }, { correct: false }, { delayed: true }]) {
    assert.equal(masteryAt(review(undefined, 0, setup), 0), 0);
  }
  let word = review(undefined, day);
  const first = masteryAt(word, day);
  assert.equal(Math.round(first), 9);
  for (let repeat = 1; repeat <= 120; repeat++) word = review(word, day + repeat * 30_000);
  assert.equal(masteryAt(word, day), first);
  word = review(word, 3 * day);
  assert.equal(word.halfLife, 2);
  assert.equal(masteryAt(word, 3 * day), first / 2);
  assert.equal(word.stage, 0);
});

test("a scheduled multiple-choice review strengthens retention, and a lapse keeps prior evidence", () => {
  let word = review(undefined, 0);
  assert.equal(recallReviewDue(card, word, day - 1), false);
  assert.equal(recallReviewDue(card, word, day), true);
  word = review(word, day, { delayed: true, choices: 2 });
  assert.equal(word.halfLife, 3);
  assert.equal(Math.round(masteryAt(word, day)), 20);
  word = review(word, 4 * day, { delayed: true });
  word = review(word, 11 * day, { delayed: true });
  const stable = word;
  word = review(word, 25 * day, { delayed: true, correct: false });
  assert.ok(masteryAt(word, 25 * day) < masteryAt(stable, 25 * day));
  assert.equal(word.reviewGap, 7 * day);
  assert.equal(word.checks.length, 4);
  const tooEarly = review(word, 26 * day, { delayed: true });
  assert.equal(tooEarly.halfLife, word.halfLife);
  assert.equal(recallReviewDue(card, tooEarly, 32 * day - 1), false);
  assert.equal(recallReviewDue(card, tooEarly, 32 * day), true);
  word = review(tooEarly, 56 * day, { delayed: true });
  assert.equal(word.stage, 5);
  assert.deepEqual(word.checks.map(check => check.correct), [true, true, true, false, true]);
});

test("daily practice of a shared word preserves its due date and cannot substitute for a longer gap", () => {
  const initial = review(review(undefined, 0), day, { delayed: true });
  // Simulate an existing recall record saved before explicit due dates.
  const { dueAt, ...saved } = initial;
  let word = review(saved, 2 * day);
  word = review(word, 3 * day);
  assert.equal(recallReviewDue(card, word, dueAt - 1), false);
  assert.equal(recallReviewDue(card, word, dueAt), true);

  word = review(word, dueAt, { delayed: true });
  assert.equal(word.stage, initial.stage);
  assert.equal(word.halfLife, initial.halfLife);
  assert.deepEqual(word.checks, initial.checks);
  assert.equal(word.updatedAt, 4 * day);
  assert.equal(recallReviewDue(card, word, 7 * day - 1), false);

  word = review(word, 7 * day, { delayed: true });
  assert.equal(word.stage, 2);
  assert.ok(word.halfLife > initial.halfLife);
  assert.deepEqual(word.checks.at(-1), { correct: true, elapsed: 3 * day });
});

test("a review is still due just after ordinary practice without refreshing mastery", () => {
  const initial = review(undefined, 0);
  const recent = review(initial, day - 1000);
  assert.equal(recallReviewDue(card, recent, day), true);
  const word = review(recent, day, { delayed: true });
  assert.equal(word.updatedAt, initial.updatedAt);
  assert.equal(word.halfLife, initial.halfLife);
  assert.deepEqual(word.checks, []);
  assert.equal(recallReviewDue(card, word, day + 1), false);
  assert.equal(recallReviewDue(card, word, 2 * day), true);
});

test("a different definition gets a fresh check without affecting other words", () => {
  const word = review(review(undefined, 0), day, { delayed: true });
  const corrected = practiceCards([raw("shared", "みる", "to look at")])[0];
  assert.equal(recallReviewDue(corrected, word, 100 * day), false);
  const next = review(word, day + 1, { answer: corrected });
  assert.equal(next.id, word.id);
  assert.equal(next.halfLife, 2);
  assert.deepEqual(next.checks, []);
  assert.equal(next.stage, 0);
});

test("legacy recognition history seeds progress without granting recall milestones", () => {
  const previous = { id: card.id, score: 100, updatedAt: day, lastSeenAt: day,
    halfLife: 365, stage: 5, checks: [{ correct: true }, { correct: false }], version: 1 };
  const upgraded = upgradePracticeProgress(previous);
  assert.equal(upgradePracticeProgress(upgraded), upgraded);
  assert.equal(upgraded.halfLife, 2.5);
  assert.equal(upgraded.stage, 0);
  assert.deepEqual(upgraded.checks, []);
  assert.equal(upgradePracticeProgress({ ...previous, score: 0 }).halfLife, 0);
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

const phrase = (cue, translation, targets) => ({
  cue, kana: "ねこといぬ。", romaji: "Neko to inu.", translation, targets, peeks: [],
});

test("the quiz finishes each phrase in word order and keeps every repeated occurrence", () => {
  const cards = practiceCards([
    quizWord("cat", "ねこ", "neko", "cat", 10, "名詞"),
    quizWord("dog", "いぬ", "inu", "dog", 10, "名詞"),
    quizWord("and", "と", "to", "and", 100, "助詞"),
    quizWord("bird", "とり", "tori", "bird", 1, "名詞"),
    quizWord("fish", "さかな", "sakana", "fish", 1, "名詞"),
  ]);
  const cat = ["cat", 0, 2, 0, 4];
  const phrases = [
    phrase("c00001", "A cat and a dog.", [cat, ["and", 2, 3, 5, 7], ["dog", 3, 5, 8, 11]]),
    { ...phrase("c00002", "A cat and another cat.", [cat, ["cat", 3, 5, 8, 12]]),
      kana: "ねことねこ。", romaji: "Neko to neko." },
  ];
  const shown = [];
  let question = nextPhraseQuestion(phrases, cards);
  while (question) {
    shown.push([question.phrase.cue, question.card.id, question.example[3], question.phrase.translation]);
    assert.equal(question.choices.length, 4);
    assert.ok(question.choices.every(choice => choice.id !== "and"));
    question = nextPhraseQuestion(phrases, cards, question.line, question.word + 1);
  }
  assert.deepEqual(shown, [
    ["c00001", "cat", 0, "A cat and a dog."], ["c00001", "dog", 3, "A cat and a dog."],
    ["c00002", "cat", 0, "A cat and another cat."], ["c00002", "cat", 3, "A cat and another cat."],
  ]);
});

test("unanswered and missed legacy appearances still get the teaching card", () => {
  const { word, event } = presentPracticeCard(card, undefined, "first-appearance", 0);
  const session = createSubtitlePractice();
  assert.equal(session.isNewWord(card, word), true);
  assert.equal(session.isNewWord(card, { ...word, reviewContext: { correct: false } }), true);
  assert.equal(session.isNewWord(card, { ...word, reviewContext: { correct: true } }), false);

  const answered = gradePracticeCard(word, event, { correct: true, choices: 4, spaced: true, at: 1 });
  assert.ok(answered.halfLife > 0);
  assert.equal(session.isNewWord(card, answered), false);

  const taught = markPracticeTaught(card, word);
  assert.deepEqual(taught, { ...word, taught: true });
  assert.equal(markPracticeTaught(card, taught), taught);
  const reopened = createSubtitlePractice();
  assert.equal(reopened.isNewWord(card, presentPracticeCard(card, taught, "later-appearance", day).word), false);
  assert.equal(reopened.isNewWord(card, { ...taught, readingKey: "changed" }), true);
});

test("teaching new words replays the whole subtitle once before the next cue or page", () => {
  const cards = practiceCards([
    quizWord("cat", "ねこ", "neko", "cat"),
    quizWord("dog", "いぬ", "inu", "dog"),
    quizWord("bird", "とり", "tori", "bird"),
    quizWord("fish", "さかな", "sakana", "fish"),
  ]);
  const cat = ["cat", 0, 2, 0, 4];
  const dog = ["dog", 3, 5, 8, 11];
  const bird = ["bird", 6, 8, 12, 16];
  const line = { ...phrase("c00001", "A cat, a dog and a bird.", [cat, dog, bird]),
    kana: "ねこ、いぬ、とり。", romaji: "Neko to inu tori." };
  const nextLine = phrase("c00002", "A cat.", [cat]);
  const deck = { cards, phrases: [line, nextLine] };
  const session = createSubtitlePractice();
  const first = nextPhraseQuestion(deck.phrases, cards);
  const familiar = presentPracticeCard(first.card, undefined, "known-appearance", 0).word;
  assert.equal(session.isNewWord(first.card, markPracticeTaught(first.card, familiar)), false);
  const second = session.advance(deck, first).question;
  assert.equal(session.isNewWord(second.card), true);
  session.teach(second);
  const third = session.advance(deck, second).question;
  assert.equal(third.card.id, "bird");
  assert.equal(session.isNewWord(third.card), true);
  session.teach(third);

  const { question: rewind, replay } = session.advance(deck, third);
  assert.equal(replay, true);
  assert.equal(rewind.word, 0);
  assert.equal(rewind.card.id, "cat");
  const secondAgain = session.advance(deck, rewind).question;
  assert.equal(secondAgain.word, 1);
  assert.equal(session.isNewWord(secondAgain.card), false);
  const thirdAgain = session.advance(deck, secondAgain).question;
  assert.equal(thirdAgain.word, 2);
  assert.equal(session.isNewWord(thirdAgain.card), false);
  const nextQuestion = session.advance(deck, thirdAgain).question;
  assert.equal(nextQuestion.phrase, nextLine);
  assert.equal(session.hasReplay(line.cue), false);
  assert.equal(session.advance(deck, nextQuestion).question, undefined);

  const lastPage = { cards, phrases: [line] };
  const lastSession = createSubtitlePractice();
  lastSession.teach(third);
  const finalReplay = lastSession.advance(lastPage, third);
  assert.equal(finalReplay.replay, true);
  let remaining = finalReplay.question;
  for (let word = 0; word < line.targets.length; word++) {
    assert.equal(remaining.word, word);
    remaining = lastSession.advance(lastPage, remaining).question;
  }
  assert.equal(remaining, undefined);
});

test("contextual questions preserve the prepared answer and choices in subtitle order", () => {
  const cards = practiceCards([
    quizWord("cat", "ねこ", "neko", "cat", 10, "名詞"),
    quizWord("dog", "いぬ", "inu", "dog", 10, "名詞"),
    quizWord("bird", "とり", "tori", "bird", 1, "名詞"),
    quizWord("fish", "さかな", "sakana", "fish", 1, "名詞"),
  ]);
  const meanings = ["hound", "cat", "wolf", "fox"];
  const dog = ["dog", 3, 5, 8, 11, meanings];
  const line = phrase("c00001", "A cat and a hound.", [["cat", 0, 2, 0, 4], dog]);
  const first = nextPhraseQuestion([line], cards);
  assert.equal(first.card.id, "cat");
  const second = nextPhraseQuestion([line], cards, first.line, first.word + 1);
  assert.equal(second.word, 1);
  assert.equal(second.card.id, "dog");
  assert.equal(second.choices.find(choice => choice.id === "dog").meaning, "hound");
  assert.deepEqual(new Set(second.choices.map(choice => choice.meaning)), new Set(meanings));
});

test("reverse questions keep the cue intact and use distinct Japanese choices for its reviewed translation", () => {
  const noun = (id, written, kana, romaji, meaning) => ({
    ...quizWord(id, kana, romaji, meaning, 10, "名詞"), word: written,
  });
  const cards = practiceCards([
    noun("dog", "犬", "いぬ", "inu", "dog"),
    noun("synonym", "猟犬", "りょうけん", "ryouken", "hound"),
    noun("homophone", "狗", "いぬ", "inu", "animal"),
    noun("cat", "猫", "ねこ", "neko", "cat"),
    noun("book", "本", "ほん", "hon", "book"),
    { ...quizWord("see", "みる", "miru", "to see", 10), word: "見る" },
    noun("fish", "魚", "さかな", "sakana", "fish"),
  ]);
  const cue = { ...phrase("c00001", "🐾 A cat and a HOUND saw a book. A hunting dog and another dog were there, too.", [
    ["cat", 0, 2, 0, 4, ["cat", "bat", "rat", "hamster"]],
    ["dog", 3, 5, 8, 11, ["hound", "cat", "wolf", "fox"]],
    ["book", 6, 8, 15, 18, ["book"]],
    ["see", 9, 11, 21, 25, ["saw"]],
    ["synonym", 12, 17, 27, 34, ["hunting dog"]],
    ["homophone", 18, 20, 38, 41, ["another dog"]],
  ]), japanese: "猫とイヌが本を見た。猟犬と狗もいた。", japaneseTargets: [[0, 1], [2, 4], [5, 6], [7, 9], [10, 12], [13, 14]],
  kana: "ねことイヌがほんをみた。りょうけんといぬもいた。",
  romaji: "Neko to inu ga hon o mita. Ryouken to inu mo ita." };

  const first = nextPhraseQuestion([cue], cards);
  const reverse = nextPhraseQuestion([cue], cards, first.line, first.word + 1, true);
  assert.equal(first.englishTarget, undefined);
  assert.equal(reverse.phrase, cue);
  assert.equal(reverse.card.id, "dog");
  assert.equal(reverse.card.written, "犬");
  assert.equal(reverse.card.meaning, "dog");
  assert.equal(Array.from(cue.translation).slice(...reverse.englishTarget).join(""), "HOUND");
  assert.deepEqual(new Set(reverse.choices), new Set([
    { id: "dog", written: "イヌ", kana: "イヌ", romaji: "inu" },
    { id: "cat", written: "猫", kana: "ねこ", romaji: "Neko" },
    { id: "book", written: "本", kana: "ほん", romaji: "hon" },
    { id: "see", written: "見た", kana: "みた", romaji: "mita" },
  ]));

  for (const translation of [null, "A hound and another hound.", "A houndfish.", "A dog."]) {
    const fallback = nextPhraseQuestion([{ ...cue, translation }], cards, 0, 1, true);
    assert.equal(fallback.englishTarget, undefined);
    assert.equal(fallback.choices.find(choice => choice.id === "dog").meaning, "hound");
  }
  const noAlternatives = nextPhraseQuestion([cue], cards.slice(0, 4), 0, 1, true);
  assert.equal(noAlternatives.englishTarget, undefined);
  assert.equal(noAlternatives.card.id, "dog");
  const unaligned = nextPhraseQuestion([{ ...cue, japaneseTargets: [[0, 1], [2, 4], null, [7, 9], [10, 12], [13, 14]] }],
    cards, 0, 1, true);
  assert.equal(unaligned.englishTarget, undefined);
  const readingsOnly = nextPhraseQuestion([{ ...cue, japanese: undefined, japaneseTargets: undefined }], cards, 0, 1, true);
  assert.ok(readingsOnly.englishTarget);
  assert.ok(readingsOnly.choices.every(choice => !choice.written));
});

test("short subtitle choice sets use other cues and the library to keep all four cards", () => {
  const words = practiceCards([
    quizWord("blue", "あおい", "aoi", "blue", 10, "形容詞"),
    quizWord("hot", "あつい", "atsui", "hot", 10, "形容詞"),
    quizWord("cold", "さむい", "samui", "cold", 10, "形容詞"),
    quizWord("tall", "たかい", "takai", "tall", 10, "形容詞"),
    quizWord("room", "へや", "heya", "room", 10, "名詞"),
  ]);
  const cue = { cue: "c00001", kana: "あおいそらだ。", romaji: "Aoi sora da.", translation: "A blue sky.",
    targets: [["blue", 0, 3, 0, 3, ["blue", "hot"]]] };
  const reverse = nextPhraseQuestion([cue], words, 0, 0, true);
  assert.equal(reverse.englishTarget, undefined);
  assert.deepEqual(new Set(reverse.choices.map(choice => choice.meaning)), new Set(["blue", "hot", "cold", "tall"]));

  const [blue, hot, cold, tall] = words;
  const forward = nextPhraseQuestion([cue], [blue, hot], 0, 0, false, [cold, tall]);
  assert.deepEqual(new Set(forward.choices.map(choice => choice.meaning)), new Set(["blue", "hot", "cold", "tall"]));
  assert.equal(forward.choices.find(choice => choice.id === "blue").meaning, "blue");
  const ambiguous = nextPhraseQuestion([{ ...cue, translation: "A blue sky and blue waves." }],
    [blue, hot, cold], 0, 0, true, [tall]);
  assert.equal(ambiguous.englishTarget, undefined);
  assert.equal(ambiguous.choices.length, 4);
  assert.equal(nextPhraseQuestion([cue], [blue, hot], 0, 0, true), undefined);
});

test("color questions prefer other hues and still fill four distinct choices", () => {
  const episode = practiceCards([
    quizWord("blue", "あおい", "aoi", "blue", 10, "形容詞"),
    quizWord("azure", "そらいろ", "sorairo", "sky blue", 10, "名詞"),
    quizWord("green", "みどり", "midori", "green (colour)", 10, "名詞"),
    quizWord("hot", "あつい", "atsui", "hot", 10, "形容詞"),
    quizWord("tall", "たかい", "takai", "tall", 10, "形容詞"),
    { ...quizWord("plane", "ひこうき", "hikouki", "airplane", 10, "名詞"), meanings: ["airplane", "yellow"] },
  ]);
  const others = practiceCards([
    quizWord("red", "あかい", "akai", "red", 10, "形容詞"),
    quizWord("yellow", "きいろい", "kiiroi", "yellow", 10, "形容詞"),
  ]);
  const cue = { cue: "c00001", kana: "あおいいろだ。", romaji: "Aoi iro da.", translation: "It's blue.",
    targets: [["blue", 0, 3, 0, 3, ["blue", "red"]]] };
  const question = nextPhraseQuestion([cue], episode, 0, 0, true, others);
  assert.equal(question.englishTarget, undefined);
  assert.deepEqual(new Set(question.choices.map(choice => choice.meaning)), new Set(["blue", "green (colour)", "red", "yellow"]));

  const sparse = nextPhraseQuestion([cue], episode, 0, 0, true);
  assert.equal(sparse.choices.length, 4);
  assert.ok(sparse.choices.some(choice => choice.meaning === "green (colour)"));
  assert.ok(sparse.choices.every(choice => choice.meaning !== "sky blue"));
});

test("Japanese options can reuse the reviewed meaning of an English distractor", () => {
  const cards = practiceCards([
    quizWord("tea", "おちゃ", "ocha", "tea", 10, "名詞"),
    quizWord("coffee", "コーヒー", "koohii", "coffee", 10, "名詞"),
    quizWord("water", "みず", "mizu", "water", 10, "名詞"),
    quizWord("milk", "ぎゅうにゅう", "gyuunyuu", "milk", 10, "名詞"),
    quizWord("book", "ほん", "hon", "book", 10, "名詞"),
  ]);
  const cue = { cue: "c00001", kana: "おちゃとコーヒーとみずとぎゅうにゅう。",
    romaji: "Ocha to koohii to mizu to gyuunyuu.", translation: "Tea, coffee, water and milk.",
    targets: [["tea", 0, 3, 0, 4, ["tea", "coffee", "juice", "milk"]],
      ["coffee", 4, 8, 8, 14], ["water", 9, 11, 18, 22], ["milk", 12, 18, 26, 34]] };
  const question = nextPhraseQuestion([cue], cards, 0, 0, true);
  assert.deepEqual(question.englishTarget, [0, 3]);
  assert.deepEqual(new Set(question.choices.map(choice => choice.id)), new Set(["tea", "coffee", "water", "milk"]));
});

test("the quiz prefers distinct choices from the same part of speech and excludes valid alternatives", () => {
  const prompt = quizWord("choose", "えらぶ", "erabu", "to choose", 100);
  const cards = practiceCards([
    { ...prompt, meanings: ["to choose", "to select"] },
    quizWord("select", "えりぬく", "erinuku", "select", 20),
    quizWord("homophone", "えらぶ", "erabu", "to publish", 20),
    quizWord("carry", "はこぶ", "hakobu", "to carry", 3),
    quizWord("change", "かえる", "kaeru", "to change", 2),
    quizWord("return", "もどる", "modoru", "to return", 1),
    quizWord("ship", "ふね", "fune", "ship", 20, "名詞"),
  ]);
  const lines = [{ cue: "c00001", kana: "えらぶ。", romaji: "Erabu.",
    targets: [["choose", 0, 3, 0, 5]], translation: "Choose." }];
  const question = nextPhraseQuestion(lines, cards);
  assert.equal(question.card.id, "choose");
  assert.deepEqual(new Set(question.choices.map(choice => choice.id)), new Set(["choose", "carry", "change", "return"]));
});
