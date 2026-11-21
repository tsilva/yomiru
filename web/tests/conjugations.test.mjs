import assert from "node:assert/strict";
import test from "node:test";
import { readSelection } from "../api/vocabulary-selection.mjs";
import { conjugationVerbGroup, dictionaryVerbGroup, prepareConjugations } from "../lib/conjugations.mjs";
import { conjugationDeckWordIds, conjugationQuestions, episodeConjugationRound, sameConjugation }
  from "../src/conjugation-practice.mjs";
import { conjugationGuides, verbGroupLabels } from "../src/conjugation-guides.mjs";
import { orderPracticeReview } from "../src/practice-review.mjs";

function prepare(written, kana, ...classes) {
  return prepareConjugations({ aliases: [written], reading: kana,
    jmdictSenses: [{ forms: [written], verbClasses: classes }] })[written];
}

test("dictionary classes use explicit tags and support older prepared readings", () => {
  assert.equal(dictionaryVerbGroup("たべる", [[["v1"], null]]), "ichidan");
  assert.equal(dictionaryVerbGroup("する", [[["vs", "vs-i"], null]]), "irregular");
  assert.equal(dictionaryVerbGroup("よむ", [[null, "よみます"]]), "godan");
  assert.equal(dictionaryVerbGroup("かえる", [[["v1"], null], [["v5r"], null]]), null);
});

test("the import prepares Japanese readings and four distinct choices for each supported form", () => {
  const regular = [
    ["買う", "かう", "v5u", "買った"], ["歩く", "あるく", "v5k", "歩いた"],
    ["泳ぐ", "およぐ", "v5g", "泳いだ"], ["話す", "はなす", "v5s", "話した"],
    ["待つ", "まつ", "v5t", "待った"], ["死ぬ", "しぬ", "v5n", "死んだ"],
    ["遊ぶ", "あそぶ", "v5b", "遊んだ"], ["読む", "よむ", "v5m", "読んだ"],
    ["帰る", "かえる", "v5r", "帰った"], ["食べる", "たべる", "v1", "食べた"],
    ["行く", "いく", "v5k-s", "行った"],
    ["為る", "する", "vs-i", "した"], ["来る", "くる", "vk", "来た"],
  ];
  for (const [written, kana, verbClass, past] of regular) {
    const forms = prepare(written, kana, verbClass);
    const byId = new Map(forms.map(form => [form.id, form]));
    assert.equal(byId.get("plain-past").written, past);
    for (const form of forms) {
      assert.equal(form.alternatives.length, 3);
      const answers = [form, ...form.alternatives.map(id => byId.get(id))];
      for (const script of ["written", "kana", "romaji"]) {
        assert.equal(new Set(answers.map(answer => answer[script])).size, 4);
      }
    }
  }
  const walk = prepare("歩く", "あるく", "v5k").find(form => form.id === "polite-past-negative");
  assert.deepEqual([walk.written, walk.kana, walk.romaji], ["歩きませんでした", "あるきませんでした", "arukimasen deshita"]);
  assert.equal(prepare("来る", "くる", "vk").find(form => form.id === "plain-negative").kana, "こない");
  assert.equal(prepare("有る", "ある", "v5r-i").find(form => form.id === "plain-negative").written, "ない");
  assert.equal(prepare("答える", "こたえる", "v1", "v5r"), undefined);
  assert.equal(prepare("勉強", "べんきょう", "vs"), undefined);
});

test("only attempted verb forms enter mixed global review and episode rounds introduce forms by frequency", () => {
  const walk = { id: "walk", written: "歩く", kana: "あるく", romaji: "aruku", meaning: "to walk",
    forms: prepare("歩く", "あるく", "v5k") };
  const eat = { id: "eat", written: "食べる", kana: "たべる", romaji: "taberu", meaning: "to eat",
    forms: prepare("食べる", "たべる", "v1") };
  const questions = conjugationQuestions([walk, eat]);
  const [attempted, seen] = questions;
  const now = 1000;
  const progress = new Map([
    [attempted.card.id, { wordId: walk.id, readingKey: attempted.card.readingKey, attemptedAt: 500,
      reviewContext: { correct: false }, dueAt: 800 }],
    [seen.card.id, { wordId: walk.id, readingKey: seen.card.readingKey, lastSeenAt: 500 }],
  ]);
  assert.deepEqual(conjugationDeckWordIds(progress), ["walk"]);
  assert.deepEqual(questions.filter(({ card }) => sameConjugation(card, progress.get(card.id))), [attempted]);
  const round = episodeConjugationRound(questions, progress, now);
  assert.deepEqual(round.slice(0, 2), [attempted, seen]);
  assert.equal(round.length, 12);
  assert.ok(round.every(({ card }) => card.wordId === walk.id));

  const vocab = [{ card: { id: "walk" } }, { card: { id: "eat" } }, { card: { id: "write" } }];
  progress.set("walk", { halfLife: 1, dueAt: 600 });
  progress.set("eat", { halfLife: 1, dueAt: 700 });
  progress.set("write", { halfLife: 1, dueAt: 1100 });
  assert.deepEqual(orderPracticeReview([...vocab, attempted], progress, now), [vocab[0], attempted, vocab[1], vocab[2]]);
});

test("every prepared form has a romaji guide and questions carry the dictionary verb group", () => {
  const verbs = [
    ["帰る", "かえる", "kaeru", ["v5r", "vs"], "godan"],
    ["食べる", "たべる", "taberu", ["v1"], "ichidan"],
    ["為る", "する", "suru", ["vs-i"], "irregular"],
    ["来る", "くる", "kuru", ["vk"], "irregular"],
  ];
  const formIds = new Set();
  for (const [written, kana, romaji, verbClasses, group] of verbs) {
    const forms = prepare(written, kana, ...verbClasses);
    const verbGroup = conjugationVerbGroup(kana, forms);
    const [verb] = conjugationQuestions([{ id: romaji, written, kana, romaji, forms, verbGroup }]);
    assert.equal(verb.conjugation.group, group);
    for (const { id } of forms) {
      formIds.add(id);
      const { use, common, groups } = conjugationGuides[id];
      if (!common) assert.deepEqual(Object.keys(groups), Object.keys(verbGroupLabels));
      for (const rule of [use, ...(common ? [common] : Object.values(groups))]) {
        assert.ok(rule.trim());
        assert.doesNotMatch(rule, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
      }
    }
  }
  assert.deepEqual([...formIds].sort(), Object.keys(conjugationGuides).sort());
});

test("conjugation requests require a pinned episode or a bounded list of history IDs", () => {
  const publication = "a".repeat(64), title = "tt0112159:1:1";
  const episode = { mode: "conjugation", publication, scope: "titles", titles: [title] };
  assert.deepEqual(readSelection(episode).episodes, [{ id: title }]);
  assert.equal(readSelection({ ...episode, titles: [title, "tt0112159:1:2"] }), null);
  const review = { mode: "conjugation-review", publication, scope: "all", wordIds: ["walk"] };
  assert.deepEqual(readSelection(review), review);
  assert.equal(readSelection({ ...review, wordIds: ["walk", "walk"] }), null);
  assert.equal(readSelection({ ...review, wordIds: [] }), null);
});
