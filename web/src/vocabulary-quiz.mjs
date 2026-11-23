import { colorHue } from "./practice-distractors.mjs";
import { englishKey, hiraganaKey, isPracticePartOfSpeech, shufflePracticeItems, wasIntroduced } from "./vocabulary-practice.mjs";

export const quizKeys = ["1", "2", "3", "4"];

export function episodeStopAt(stops, time) {
  const next = stops.findIndex(([start]) => start >= time);
  if (next <= 0) return next === 0 ? stops[0] : stops.at(-1);
  const before = stops[next - 1];
  const after = stops[next];
  return time - before[0] <= after[0] - time ? before : after;
}

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

function sharesAnswer(keys, answers, hue) {
  return [...keys].some(key => answers.has(answerKey(key)) || (hue && colorHue(key) === hue));
}

function distractors(prompt, cards, meanings = [prompt.meaning]) {
  const correct = englishKey(meanings[0]);
  const hue = colorHue(correct);
  const answers = new Set([...prompt.acceptable, correct].map(answerKey));
  const used = new Set([...answers, ...meanings.map(englishKey).map(answerKey)]);
  const alternatives = [];
  for (const card of cards) {
    const key = answerKey(card.meaningKey);
    if (card.id === prompt.id || card.readingKey === prompt.readingKey
      || card.romaji === prompt.romaji || used.has(key)
      || sharesAnswer(card.acceptable, answers, hue)) continue;
    alternatives.push(card);
    used.add(key);
    if (meanings.length + alternatives.length === quizKeys.length) break;
  }
  return alternatives;
}

function prioritizeAlternatives(card, shuffled) {
  const similar = candidate => card.partOfSpeech && candidate.partOfSpeech
    ? candidate.partOfSpeech === card.partOfSpeech
    : candidate.meaningKey.startsWith("to ") === card.meaningKey.startsWith("to ");
  const sameKind = [], other = [];
  for (const candidate of shuffled) {
    (similar(candidate) ? sameKind : other).push(candidate);
  }
  return [...sameKind, ...other];
}

function prioritizePhraseAlternatives(card, prepared, episode, fallback) {
  const candidates = [...prioritizeAlternatives(card, episode), ...prioritizeAlternatives(card, fallback)];
  const hue = colorHue(englishKey(prepared?.[0] ?? card.meaning));
  const reviewed = new Set(prepared?.slice(1).map(meaning => answerKey(englishKey(meaning))));
  const colors = new Map(), extraColors = [], reviewedMatches = [], other = [];
  for (const candidate of candidates) {
    // The primary gloss avoids unrelated homographs with a color or reviewed alias.
    const candidateHue = hue && colorHue(candidate.meaningKey);
    if (candidateHue && candidateHue !== hue) {
      if (colors.has(candidateHue)) extraColors.push(candidate);
      else colors.set(candidateHue, candidate);
    } else if (reviewed.has(answerKey(candidate.meaningKey))) reviewedMatches.push(candidate);
    else other.push(candidate);
  }
  return [...colors.values(), ...extraColors, ...reviewedMatches, ...other];
}

export function phraseExample(phrase, target) {
  return [phrase.cue, phrase.kana, phrase.romaji, ...target.slice(1, 5), phrase.peeks];
}

export function preparedQuizChoices(id, prepared) {
  return shufflePracticeItems(prepared.map((meaning, index) => ({ id: index ? `alternative-${index}` : id, meaning })));
}

function englishQuestion(card, prepared, candidates) {
  const meanings = prepared ?? [card.meaning];
  if (!meanings.length) return null;
  const alternatives = meanings.length < quizKeys.length ? distractors(card, candidates, meanings) : [];
  if (meanings.length + alternatives.length !== quizKeys.length) return null;
  return { choices: prepared ? preparedQuizChoices(card.id, [...prepared, ...alternatives.map(choice => choice.meaning)])
    : shufflePracticeItems([card, ...alternatives]) };
}

function translationSpan(translation, meaning) {
  if (!meaning) return null;
  const key = answerKey(englishKey(meaning));
  if (!key) return null;
  const pattern = key.replace(/’/gu, "'").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replaceAll(" ", "\\s+");
  const matches = [...translation.replace(/’/gu, "'").matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"))];
  if (matches.length !== 1) return null;
  const [{ 0: match, index }] = matches;
  const start = Array.from(translation.slice(0, index)).length;
  return [start, start + Array.from(match).length];
}

function spanText(characters, [start, end] = []) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || start >= end || end > characters.length) return "";
  return characters.slice(start, end).join("").trim();
}

function japaneseQuestion(phrase, word, card, byId) {
  const prepared = phrase.targets[word][5];
  const meaning = prepared?.[0];
  if (phrase.targets.length < quizKeys.length || !phrase.translation || !card.partOfSpeech || !meaning) return null;
  const englishTarget = translationSpan(phrase.translation, meaning);
  if (!englishTarget) return null;
  const [start, end] = englishTarget;
  if (phrase.targets.some(([, , , , , glosses], index) => {
    if (index === word) return false;
    const other = translationSpan(phrase.translation, glosses?.[0]);
    return other && start < other[1] && other[0] < end;
  })) return null;

  const kanaText = Array.from(phrase.kana);
  const romajiText = Array.from(phrase.romaji);
  const writtenText = Array.from(phrase.japanese?.trim() ? phrase.japanese : "");
  function choiceAt(index) {
    const [id, hs, he, rs, re] = phrase.targets[index];
    const kana = spanText(kanaText, [hs, he]);
    const romaji = spanText(romajiText, [rs, re]);
    const written = spanText(writtenText, phrase.japaneseTargets?.[index] ?? undefined);
    if (!kana || !romaji || (writtenText.length && !written)) return null;
    return { id, ...(written && { written }), kana, romaji };
  }
  const answer = choiceAt(word);
  if (!answer) return null;
  const choices = [answer];
  const correct = englishKey(meaning);
  const hue = colorHue(correct);
  const glosses = new Set([...card.acceptable, correct].map(answerKey));
  const candidates = phrase.targets.flatMap(([id, , , , , contextual], index) => {
    const candidate = byId.get(id);
    if (id === card.id || !candidate || !isPracticePartOfSpeech(candidate.partOfSpeech)
      || sharesAnswer([...candidate.acceptable, englishKey(contextual?.[0] ?? candidate.meaning)], glosses, hue)) return [];
    const choice = choiceAt(index);
    return choice ? [{ ...candidate, choice }] : [];
  });
  const readingKey = choice => hiraganaKey(choice.kana.normalize("NFKC"));
  const romajiKey = choice => choice.romaji.normalize("NFKC").toLowerCase();
  for (const { choice } of prioritizeAlternatives(card, shufflePracticeItems(candidates))) {
    if (choices.some(used => choice.id === used.id || readingKey(choice) === readingKey(used)
      || romajiKey(choice) === romajiKey(used) || (choice.written && choice.written === used.written))) continue;
    choices.push(choice);
    if (choices.length === quizKeys.length) break;
  }
  return choices.length === quizKeys.length ? { englishTarget, meaning, choices: shufflePracticeItems(choices) } : null;
}

export function nextPhraseQuestion(phrases, cards, phraseIndex = 0, wordIndex = 0, preferJapanese = false, fallbackCards = []) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const episode = shufflePracticeItems(cards);
  const fallback = shufflePracticeItems(fallbackCards);
  for (let line = phraseIndex; line < phrases.length; line++) {
    const phrase = phrases[line];
    for (let word = line === phraseIndex ? wordIndex : 0; word < phrase.targets.length; word++) {
      const target = phrase.targets[word];
      const [id, , , , , prepared] = target;
      const card = byId.get(id);
      if (!card) continue;
      const candidates = prioritizePhraseAlternatives(card, prepared, episode, fallback);
      const question = (preferJapanese && japaneseQuestion(phrase, word, card, byId))
        || englishQuestion(card, prepared, candidates)
        || (!preferJapanese && japaneseQuestion(phrase, word, card, byId));
      if (question) return { card, phrase, line, word, example: phraseExample(phrase, target), ...question };
    }
  }
}

export function createSubtitlePractice() {
  const taught = new Set();
  const replays = new Map();
  return {
    isNewWord(card, record) {
      return !taught.has(card.id) && !wasIntroduced(record);
    },
    teach({ card, phrase }) {
      taught.add(card.id);
      replays.set(phrase.cue, "pending");
    },
    hasReplay(cue) {
      return replays.has(cue);
    },
    advance({ phrases, cards, fallbackCards }, { phrase: { cue }, line, word }, preferJapanese) {
      const question = nextPhraseQuestion(phrases, cards, line, word + 1, preferJapanese, fallbackCards);
      if (question?.phrase.cue === cue) return { question };
      if (replays.get(cue) === "pending") {
        replays.set(cue, "in progress");
        return { question: nextPhraseQuestion(phrases, cards, line, 0, preferJapanese, fallbackCards), replay: true };
      }
      replays.delete(cue);
      return { question };
    },
  };
}

const reviewInterval = 2;
export function episodeQuestionFor(card, cards, exposed = () => false) {
  const example = card?.examples?.find(example => !exposed(example));
  if (!example) return undefined;
  const alternatives = distractors(card, prioritizeAlternatives(card, cards));
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
