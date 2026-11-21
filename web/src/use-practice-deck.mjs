import { useEffect, useEffectEvent, useRef, useState } from "react";
import { practiceCheckLimit, practiceMembership, selectedReviewIds, toPracticeCard } from "./practice-deck.mjs";
import { createPracticeReview, orderPracticeReview } from "./practice-review.mjs";
import { presentedWords, shufflePracticeItems } from "./vocabulary-practice.mjs";

const refillAt = 8;

function checksFor(progress) {
  return [...progress.values()].map(({ id, readingKey, meaningKey }) => [id, readingKey ?? "", meaningKey ?? ""]);
}

function addChecks(membership, checks, statuses) {
  if (typeof statuses !== "string" || statuses.length !== checks.length) throw new Error("Could not verify mastery.");
  checks.forEach(([id], index) => membership.set(id, statuses[index]));
}

async function checkProgress(load, signal, checks, membership) {
  for (let i = 0; i < checks.length; i += practiceCheckLimit) {
    const batch = checks.slice(i, i + practiceCheckLimit);
    const { checked } = await load("practice-membership", { checks: batch }, signal);
    addChecks(membership, batch, checked);
  }
  return membership;
}

function uniqueCards(cards) {
  return [...new Map(cards.map(card => [card.id, card])).values()];
}

function applySupplementalChecks(membership, checks, cards) {
  for (const [id, reading, meaning] of checks) {
    if (cards.has(id) && (!membership.get(id) || membership.get(id) === "0")) {
      membership.set(id, practiceMembership(cards.get(id), reading, meaning));
    }
  }
}

async function loadMeaningReview(load, progress, signal) {
  const history = presentedWords(progress);
  if (!history.size) return [];
  const review = createPracticeReview(history.values());
  let cursor;
  do {
    const { sources, next } = await load("practice-review", { cursor }, signal);
    if (signal.aborted) return [];
    review.addSources(sources);
    cursor = next;
  } while (cursor);
  return review.questions();
}

async function loadFormReview(load, progress, signal) {
  if (!progress.size) return [];
  const { conjugationDeckWordIds, conjugationQuestions, sameConjugation } = await import("./conjugation-practice.mjs");
  const ids = conjugationDeckWordIds(progress);
  const verbs = [];
  for (let i = 0; i < ids.length; i += practiceCheckLimit) {
    const result = await load("conjugation-review", ids.slice(i, i + practiceCheckLimit), signal);
    verbs.push(...result.verbs);
  }
  return conjugationQuestions(verbs).filter(({ card }) => sameConjugation(card, progress.get(card.id)));
}

export function usePracticeDeck(load, progress, singleTitle, contextual, reviewing,
  { conjugating, conjugationProgress, loadConjugations }) {
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState("");
  const session = useRef(null);
  const matched = useRef(new Set());

  async function start(current, progress, formProgress) {
    current.loading = true;
    setError("");
    const { signal } = current.controller;
    try {
      if (conjugating) {
        const [{ verbs }, { conjugationQuestions, episodeConjugationRound }] = await Promise.all([
          loadConjugations("conjugation", null, signal), import("./conjugation-practice.mjs"),
        ]);
        if (signal.aborted) return;
        const course = conjugationQuestions(verbs);
        const questions = episodeConjugationRound(course, formProgress);
        setDeck({ course, reviewQuestions: questions, membership: new Map(), total: course.length });
        return;
      }
      if (reviewing) {
        const [meanings, forms] = await Promise.all([
          loadMeaningReview(load, progress, signal),
          loadFormReview(loadConjugations, formProgress, signal),
        ]);
        if (signal.aborted) return;
        const questions = orderPracticeReview([...meanings, ...forms], new Map([...progress, ...formProgress]));
        const membership = new Map(meanings.map(({ card }) => [card.id, "2"]));
        setDeck({ reviewQuestions: questions, membership, total: meanings.length });
        return;
      }
      const checks = checksFor(progress);
      const first = checks.slice(0, practiceCheckLimit);
      const review = singleTitle || contextual ? [] : selectedReviewIds(progress, null, new Set(), Date.now());
      const result = await load("practice-page", { checks: first, review }, signal, contextual ? "phrase" : undefined);
      const playableIds = result.playableIds && new Set(result.playableIds);
      const supplemental = new Map((result.supplementalCards ?? []).map(row => [row[0], toPracticeCard(row)]));
      const membership = new Map();
      addChecks(membership, first, result.checked);
      await checkProgress(load, signal, checks.slice(first.length).filter(([id]) => !playableIds || playableIds.has(id)), membership);
      if (playableIds) for (const id of membership.keys()) if (!playableIds.has(id)) membership.delete(id);
      applySupplementalChecks(membership, checks, supplemental);
      if (signal.aborted) return;
      const fresh = result.cards.map(toPracticeCard);
      const cards = uniqueCards([...fresh, ...result.reviews.map(toPracticeCard)]);
      matched.current.clear();
      const fallbackCards = result.fallbackCards?.map(toPracticeCard);
      setDeck({ fresh, cards, fallbackCards, membership, playableIds, supplemental, next: result.next, continuation: result.continuation,
        total: result.total, paged: Boolean(result.next), phrases: result.phrases });
    } catch (failure) {
      if (!signal.aborted) setError(failure.message);
    } finally {
      current.loading = false;
    }
  }

  const open = useEffectEvent(current => { void start(current, progress, conjugationProgress); });
  useEffect(() => {
    setDeck(null);
    setError("");
    if (conjugating ? !loadConjugations : !load) return;
    const current = { controller: new AbortController(), loading: false };
    session.current = current;
    open(current);
    return () => { current.controller.abort(); session.current = null; };
  }, [load, reviewing, conjugating, loadConjugations]);

  async function refill(force = false, allowCycle = false) {
    const current = session.current;
    if (!current || current.loading || !deck || (!deck.next && (contextual || singleTitle || !allowCycle || !deck.paged))) return;
    const remaining = deck.fresh.filter(card => !matched.current.has(card.id));
    if (!force && remaining.length > refillAt) return;
    const { signal } = current.controller;
    current.loading = true;
    setError("");
    try {
      if (contextual) {
        const result = await load("practice-page", { after: deck.next }, signal, "phrase");
        if (!signal.aborted) setDeck(previous => ({ ...previous, cards: result.cards.map(toPracticeCard),
          phrases: result.phrases, next: result.next }));
        return;
      }
      const recent = deck.cards.filter(card => matched.current.has(card.id)).slice(-refillAt);
      const review = singleTitle ? [] : selectedReviewIds(progress, deck.membership, new Set(remaining.map(card => card.id)), Date.now());
      const result = await load("practice-page", { after: deck.next, review, continuation: deck.continuation }, signal);
      if (signal.aborted) return;
      if (!deck.next) matched.current.clear();
      const retainedFresh = singleTitle ? remaining
        : remaining.slice(0, refillAt);
      const fresh = uniqueCards([...retainedFresh, ...result.cards.map(toPracticeCard)]);
      const cards = uniqueCards([...fresh, ...recent, ...result.reviews.map(toPracticeCard)]);
      const retained = new Set(cards.map(card => card.id));
      matched.current = new Set([...matched.current].filter(id => retained.has(id)));
      setDeck(previous => ({ ...previous, fresh, cards, next: result.next, continuation: result.continuation }));
    } catch (failure) {
      if (!signal.aborted) setError(failure.message);
    } finally {
      current.loading = false;
    }
  }

  function onAttempt(card) {
    matched.current.delete(card.id);
    matched.current.add(card.id);
    if (!error) void refill(false, true);
  }

  function record(card, word) {
    if (reviewing || conjugating) return;
    setDeck(previous => previous && ({ ...previous, membership: new Map(previous.membership)
      .set(word.id, practiceMembership(card, word.readingKey, word.meaningKey)) }));
  }

  function repeatReview() {
    const nextRound = conjugating ? episodeConjugationRound(deck.course, conjugationProgress)
      : orderPracticeReview(deck.reviewQuestions, new Map([...progress, ...conjugationProgress]));
    const reviewQuestions = nextRound
      .map(question => ({ ...question, choices: shufflePracticeItems(question.choices) }));
    setDeck({ ...deck, reviewQuestions });
  }

  function retry() {
    const current = session.current;
    if (!current || current.loading) return;
    if (deck) void refill(true, true);
    else void start(current, progress, conjugationProgress);
  }

  async function refreshedProgress(next) {
    const current = session.current;
    if (!current || !deck) return false;
    const { signal } = current.controller;
    if (reviewing || conjugating) return !signal.aborted;
    const changed = checksFor(next).filter(([id, reading, meaning]) => {
      if (deck.playableIds && !deck.playableIds.has(id)) return false;
      const prior = progress.get(id);
      return !deck.membership.has(id) || prior?.readingKey !== reading || prior?.meaningKey !== meaning;
    });
    const membership = await checkProgress(load, signal, changed, new Map());
    applySupplementalChecks(membership, changed, deck.supplemental);
    if (signal.aborted) return false;
    setDeck(previous => previous && ({ ...previous, membership: new Map([...previous.membership, ...membership]) }));
    return true;
  }

  return { deck, error, onAttempt, record, refill, refreshedProgress, repeatReview, retry };
}
