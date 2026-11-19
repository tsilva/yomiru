const day = 86_400_000;
const gaps = [20 / 24, 3, 7, 14, 30, 60];
const masteryStage = gaps.length - 1;
const initialHalfLife = 2;
const missedPairGap = 4;
const lowerPriorityWeight = 0.25;
const lowerPriorityPartsOfSpeech = new Set(["助詞", "助動詞", "接頭辞", "接尾辞", "感動詞"]);
const kanaOnly = /^[ぁ-ゖゝゞァ-ヺヽヾー]+$/u;
const katakanaOnly = /^[ァ-ヺヽヾー]+$/u;

function englishKey(meaning) {
  return meaning.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/u, "");
}

export function practiceCards(words) {
  const cards = new Map();
  for (const { id, word, reading, romaji, meanings, count, pos } of words) {
    const written = word.normalize("NFKC");
    const kana = katakanaOnly.test(written) ? written : reading.normalize("NFKC");
    const glosses = meanings.map(meaning => meaning.trim()).filter(Boolean);
    if (!kanaOnly.test(kana) || !romaji.trim() || !glosses.length) continue;
    const meaning = glosses.find(gloss => gloss.length <= 100 && englishKey(gloss));
    if (!meaning) continue;
    const readingKey = kana.replace(/[ァ-ヶ]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
    const acceptable = new Set(glosses.map(englishKey));
    cards.set(id, { id, kana, romaji: romaji.trim().toLowerCase(), meaning, readingKey,
      meaningKey: englishKey(meaning), acceptable, count,
      lowerPriority: lowerPriorityPartsOfSpeech.has(pos?.split("/", 1)[0]) });
  }
  return [...cards.values()];
}

export function masteryAt(word, now) {
  if (!word?.score) return 0;
  return word.score * 2 ** (-Math.max(0, now - word.updatedAt) / (day * word.halfLife));
}

export function selectionPracticeStats(cards, progress, now) {
  let score = 0;
  let mastered = 0;
  for (const card of cards) {
    const word = progress.get(card.id);
    score += masteryAt(word, now);
    if (word?.stage === masteryStage && !word.needsVerification && !definitionChanged(card, word)) mastered++;
  }
  const total = cards.length;
  return { mastery: total ? score / total : 0, mastered, total };
}

function qualifyingGap(stage) {
  return gaps[stage] * day;
}

function definitionChanged(card, word) {
  return word && (word.readingKey !== card.readingKey || !card.acceptable.has(word.meaningKey));
}

function isDue(word, now) {
  return word && now >= Math.max(word.dueAt, word.lastSeenAt + word.reviewGap);
}

export function presentPracticeCard(card, word, appearanceId, shownAt) {
  const revised = definitionChanged(card, word);
  const lastSeenAt = word?.lastSeenAt ?? shownAt;
  const progress = word ?? { id: card.id, score: 0, updatedAt: shownAt, halfLife: initialHalfLife,
    dueAt: shownAt + qualifyingGap(0), reviewGap: qualifyingGap(0), stage: 0, checks: [], version: 1 };
  return {
    word: { ...progress, needsVerification: Boolean(revised || progress.needsVerification),
      lastSeenAt: Math.max(shownAt, lastSeenAt), lastAppearanceId: appearanceId,
      readingKey: card.readingKey, meaningKey: card.meaningKey },
    event: { id: appearanceId, wordId: card.id, shownAt, elapsed: Math.max(0, shownAt - lastSeenAt),
      due: Boolean(isDue(word, shownAt)), readingKey: card.readingKey, meaningKey: card.meaningKey },
  };
}

export function gradePracticeCard(word, event, { correct, choices, spaced, at, sessionStartedAt }) {
  if (word.lastAppearanceId !== event.id || choices < 2) return word;
  const score = masteryAt(word, Math.max(sessionStartedAt, word.updatedAt));
  const updatedAt = Math.max(at, word.updatedAt);
  if (word.needsVerification && spaced && choices >= 3) {
    return { ...word, updatedAt, score: correct ? Math.min(100, score + 35) : score * .85,
      halfLife: Math.min(word.halfLife, initialHalfLife), needsVerification: false,
      stage: 0, checks: [], dueAt: event.shownAt + qualifyingGap(0), reviewGap: qualifyingGap(0) };
  }
  if (event.due && spaced && choices >= 3) {
    const qualifies = event.elapsed >= qualifyingGap(word.stage);
    const checks = qualifies ? [...word.checks, { correct, elapsed: event.elapsed }].slice(-5) : word.checks;
    if (correct) {
      const proven = checks.length === 5 && checks.filter(check => check.correct).length >= 4
        && checks.some(check => check.correct && check.elapsed >= 30 * day);
      const stage = proven ? masteryStage : qualifies && word.stage < 4 ? word.stage + 1 : word.stage;
      const reviewGap = qualifyingGap(stage);
      return { ...word, score: 100, updatedAt, stage, checks, reviewGap, dueAt: event.shownAt + reviewGap,
        halfLife: qualifies ? Math.min(365, word.halfLife * 2.5) : word.halfLife };
    }
    const reviewGap = Math.max(qualifyingGap(0), qualifyingGap(word.stage) / 2);
    return { ...word, score: score * .85, updatedAt, checks, reviewGap, dueAt: event.shownAt + reviewGap,
      halfLife: Math.max(.25, word.halfLife * .8) };
  }
  if (!correct || !spaced) return word;
  return { ...word, score: Math.min(100, score + 35), updatedAt };
}

function compatible(a, b) {
  return a.readingKey !== b.readingKey && !a.acceptable.has(b.meaningKey) && !b.acceptable.has(a.meaningKey);
}

export function nextPracticeCards(cards, progress, active, lastPlayed, turn, count, now, fresh) {
  const activeIds = new Set(active.map(card => card.id));
  const options = cards.filter(card => !activeIds.has(card.id) && active.every(other => compatible(card, other)))
    .map(card => {
      const word = progress.get(card.id);
      const played = lastPlayed.get(card.id);
      const missed = played?.correct === false;
      const due = Boolean(word?.needsVerification || definitionChanged(card, word) || isDue(word, now));
      const ready = !played || turn - played.turn >= (missed ? missedPairGap : 2);
      const priority = card.lowerPriority && !played && !due && !word?.score ? card.count * lowerPriorityWeight : card.count;
      return { card, due, familiar: masteryAt(word, now) >= 55, lastTurn: played?.turn, missed, ready, priority };
    })
    .filter(option => !option.missed || option.lastTurn < turn);
  options.sort((a, b) => (a.lastTurn ?? -Infinity) === (b.lastTurn ?? -Infinity)
    ? b.priority - a.priority : (a.lastTurn ?? -Infinity) - (b.lastTurn ?? -Infinity));
  const chosen = [];
  const choose = (predicate, allowEarly = false) => {
    if (chosen.length >= count) return false;
    const fits = option => predicate(option) && !chosen.includes(option.card)
      && chosen.every(other => compatible(option.card, other));
    const option = options.find(item => (item.ready || allowEarly) && fits(item));
    if (!option) return false;
    chosen.push(option.card);
    return true;
  };
  const contentWord = option => !option.card.lowerPriority;
  while (choose(option => option.missed)) {}
  if (fresh) {
    choose(option => contentWord(option) && option.due);
    choose(option => contentWord(option) && option.familiar && !option.due);
    choose(option => contentWord(option) && option.due);
    while (chosen.length < count - 1 && choose(contentWord)) {}
    if (chosen.length === count - 1 && chosen.length > 0) choose(option => option.card.lowerPriority && option.due);
    while (choose(contentWord)) {}
  } else if (turn >= 4 || !choose(contentWord)) {
    if (turn % 3 === 1) {
      choose(option => !option.familiar && !option.due && option.lastTurn !== undefined);
    } else if (turn % 3 === 2) {
      choose(option => option.familiar && !option.due);
    } else {
      choose(option => option.lastTurn === undefined && !option.due);
    }
  }
  while (chosen.length < count) {
    if (choose(option => !option.due) || choose(() => true) || choose(option => !option.missed, true)) continue;
    // With too few pairs to match, allow an earlier retry after at least one intervening attempt.
    if (active.length + chosen.length >= 2 || !choose(() => true, true)) break;
  }
  if (fresh && chosen.length === 1) {
    for (const { card } of options) {
      const partner = options.find(option => compatible(card, option.card));
      if (partner) return [card, partner.card];
    }
  }
  return chosen;
}
