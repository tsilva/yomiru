const day = 86_400_000;
const gaps = [1, 3, 7, 14, 30, 60];
const masteryStage = gaps.length - 1;
const initialHalfLife = 2;
const retentionHorizon = 7 * day;
const recallVersion = 2;
export const masteryDescription = "Estimated chance of recalling the meaning in 7 days without more practice";
const missedPairGap = 4;
const lowerPriorityWeight = 0.25;
const lowerPriorityPartsOfSpeech = new Set(["助動詞", "接頭辞", "接尾辞", "感動詞"]);
const kanaOnly = /^[ぁ-ゖゝゞァ-ヺヽヾー]+$/u;
const katakanaOnly = /^[ァ-ヺヽヾー]+$/u;

const hiraganaKey = kana => kana.replace(/[ァ-ヶ]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0x60));

export function practiceDisplayKana(kana, word) {
  if (typeof word !== "string") return kana;
  const written = word.normalize("NFKC");
  if (!/[ァ-ヺヽヾ]/u.test(written)) return kana;

  // Restore the original kana runs where they align with the stored reading.
  const parts = written.split(/([ぁ-ゖゝゞァ-ヺヽヾー]+)/u);
  const pattern = parts.map((part, index) => index % 2 ? hiraganaKey(part) : part && "(.+?)").join("");
  const match = hiraganaKey(kana).match(new RegExp(`^${pattern}$`, "u"));
  if (!match) return kana;
  let gap = 1;
  return parts.map((part, index) => index % 2 || !part ? part : match[gap++]).join("");
}

export function shufflePracticeItems(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

function englishKey(meaning) {
  return meaning.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/u, "");
}

export function isPracticePartOfSpeech(pos) {
  return pos?.split("/", 1)[0] !== "助詞";
}

export function practiceCards(words) {
  const cards = new Map();
  for (const { id, word, reading, romaji, meanings, count, pos } of words) {
    if (!isPracticePartOfSpeech(pos)) continue;
    const written = word.normalize("NFKC");
    const kana = katakanaOnly.test(written) ? written : reading.normalize("NFKC");
    const glosses = meanings.map(meaning => meaning.trim()).filter(Boolean);
    if (!kanaOnly.test(kana) || !romaji.trim() || !glosses.length) continue;
    const meaning = glosses.find(gloss => gloss.length <= 100 && englishKey(gloss));
    if (!meaning) continue;
    const readingKey = hiraganaKey(kana);
    const acceptable = new Set(glosses.map(englishKey));
    const partOfSpeech = pos?.split("/", 1)[0];
    cards.set(id, { id, written: word, kana: practiceDisplayKana(kana, written), romaji: romaji.trim().toLowerCase(), meaning, readingKey,
      meaningKey: englishKey(meaning), acceptable, count,
      lowerPriority: lowerPriorityPartsOfSpeech.has(partOfSpeech), partOfSpeech });
  }
  return [...cards.values()];
}

export function masteryAt(word, now) {
  if (!word?.halfLife) return 0;
  const lag = Math.max(0, now - word.updatedAt) + retentionHorizon;
  return 100 * 2 ** (-lag / (day * word.halfLife));
}

export function selectionPracticeStats(cards, progress, now, byId, selection) {
  let score = 0;
  let mastered = 0;
  const count = (card, word) => {
    if (definitionChanged(card, word)) return;
    score += masteryAt(word, now);
    if (word?.stage === masteryStage) mastered++;
  };
  if (selection) {
    for (const [id, word] of progress) {
      const match = selection.membership.get(id);
      if (match !== "2") continue;
      score += masteryAt(word, now);
      if (word.stage === masteryStage) mastered++;
    }
  } else if (byId && progress.size < cards.length) {
    for (const [id, word] of progress) {
      const card = byId.get(id);
      if (card) count(card, word);
    }
  } else {
    for (const card of cards) count(card, progress.get(card.id));
  }
  const total = selection?.total ?? cards.length;
  return { mastery: total ? score / total : 0, mastered, total };
}

function qualifyingGap(stage) {
  return gaps[stage] * day;
}

function definitionChanged(card, word) {
  return word && (word.readingKey !== card.readingKey || !card.acceptable.has(word.meaningKey));
}

export function isPracticeReviewDue(word, now) {
  return Boolean(word?.halfLife && now >= word.lastSeenAt + word.reviewGap);
}

export function recallReviewDue(card, word, now) {
  return !definitionChanged(card, word) && isPracticeReviewDue(word, now);
}

export function upgradePracticeProgress(word) {
  if (!word || word.version === recallVersion) return word;
  const recognitionSuccesses = (word.checks ?? []).filter(check => check.correct).length;
  // Legacy choice answers provide a starting estimate, but cannot verify unaided recall.
  const halfLife = word.score > 0 && !word.needsVerification
    ? initialHalfLife + Math.min(5, recognitionSuccesses) * .5 : 0;
  return { id: word.id, readingKey: word.readingKey, meaningKey: word.meaningKey,
    updatedAt: word.updatedAt, lastSeenAt: word.lastSeenAt, lastAppearanceId: word.lastAppearanceId,
    halfLife, stage: 0, checks: [], reviewGap: qualifyingGap(0), version: recallVersion };
}

export function presentPracticeCard(card, word, appearanceId, shownAt) {
  const previous = upgradePracticeProgress(word);
  const due = recallReviewDue(card, previous, shownAt);
  const progress = previous && !definitionChanged(card, previous) ? previous
    : { id: card.id, updatedAt: shownAt, halfLife: 0, reviewGap: qualifyingGap(0),
      stage: 0, checks: [], version: recallVersion };
  const lastSeenAt = progress.lastSeenAt ?? shownAt;
  return {
    word: { ...progress, lastSeenAt: Math.max(shownAt, lastSeenAt), lastAppearanceId: appearanceId,
      readingKey: card.readingKey, meaningKey: card.meaningKey },
    event: { id: appearanceId, wordId: card.id, shownAt, elapsed: Math.max(0, shownAt - lastSeenAt),
      due, readingKey: card.readingKey, meaningKey: card.meaningKey },
  };
}

export function gradePracticeCard(word, event, { correct, choices, spaced, recall, at }) {
  if (word.lastAppearanceId !== event.id || !spaced) return word;
  const updatedAt = Math.max(at, word.updatedAt);
  if (!recall) {
    if (!correct || !(choices >= 2) || word.halfLife) return word;
    return { ...word, updatedAt, halfLife: initialHalfLife };
  }
  if (!event.due) return word;
  const qualifies = event.elapsed >= qualifyingGap(word.stage);
  const checks = qualifies ? [...word.checks, { correct, elapsed: event.elapsed }].slice(-5) : word.checks;
  if (!correct) {
    // Apply the lapse to the existing curve without refreshing it as a successful recall.
    return { ...word, checks, halfLife: Math.max(.25, word.halfLife * .65),
      reviewGap: Math.max(qualifyingGap(0), qualifyingGap(word.stage) / 2) };
  }
  const proven = checks.length === 5 && checks.filter(check => check.correct).length >= 4
    && checks.some(check => check.correct && check.elapsed >= 30 * day);
  const stage = proven ? masteryStage : qualifies && word.stage < 4 ? word.stage + 1 : word.stage;
  // A longer successful gap is more evidence, but one result can only move the estimate so far.
  const gain = Math.min(event.elapsed / day, word.halfLife * 1.5);
  return { ...word, updatedAt, halfLife: Math.min(365, word.halfLife + gain),
    stage, checks, reviewGap: qualifyingGap(stage) };
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
      const due = Boolean(definitionChanged(card, word) || isPracticeReviewDue(word, now));
      const ready = !played || turn - played.turn >= (missed ? missedPairGap : 2);
      const priority = card.lowerPriority && !played && !due && !word?.score ? card.count * lowerPriorityWeight : card.count;
      return { card, due, familiar: masteryAt(word, now) >= 55, lastTurn: played?.turn, missed, ready, priority };
    })
    .filter(option => !option.missed || option.lastTurn < turn);
  const compare = (a, b) => (a.lastTurn ?? -Infinity) === (b.lastTurn ?? -Infinity)
    ? b.priority - a.priority : (a.lastTurn ?? -Infinity) - (b.lastTurn ?? -Infinity);
  const chosen = [];
  const choose = (predicate, allowEarly = false) => {
    if (chosen.length >= count) return false;
    const fits = option => predicate(option) && !chosen.includes(option.card)
      && chosen.every(other => compatible(option.card, other));
    let best;
    for (const option of options) {
      if ((!option.ready && !allowEarly) || !fits(option)) continue;
      if (!best || compare(option, best) < 0) best = option;
    }
    if (!best) return false;
    chosen.push(best.card);
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
  if (fresh && count > 1 && chosen.length === 1) {
    options.sort(compare);
    for (const { card } of options) {
      const partner = options.find(option => compatible(card, option.card));
      if (partner) return [card, partner.card];
    }
  }
  return chosen;
}
