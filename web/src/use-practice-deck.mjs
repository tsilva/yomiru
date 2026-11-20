import { useEffect, useEffectEvent, useRef, useState } from "react";
import { practiceCheckLimit, practiceMembership, selectedReviewIds, toPracticeCard } from "./practice-deck.mjs";

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

export function usePracticeDeck(load, progress, singleTitle, contextual) {
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState("");
  const session = useRef(null);
  const matched = useRef(new Set());

  async function start(current, progress) {
    current.loading = true;
    setError("");
    const { signal } = current.controller;
    try {
      const checks = checksFor(progress);
      const first = checks.slice(0, practiceCheckLimit);
      const review = singleTitle ? [] : selectedReviewIds(progress, null, new Set(), Date.now());
      const result = await load("practice-page", { checks: first, review }, signal);
      const membership = new Map();
      addChecks(membership, first, result.checked);
      await checkProgress(load, signal, checks.slice(first.length), membership);
      if (signal.aborted) return;
      const fresh = result.cards.map(toPracticeCard);
      const cards = uniqueCards([...fresh, ...result.reviews.map(toPracticeCard)]);
      matched.current.clear();
      setDeck({ fresh, cards, membership, next: result.next, continuation: result.continuation,
        total: result.total, paged: Boolean(result.next), timeline: result.timeline });
    } catch (failure) {
      if (!signal.aborted) setError(failure.message);
    } finally {
      current.loading = false;
    }
  }

  const open = useEffectEvent(current => { void start(current, progress); });
  useEffect(() => {
    setDeck(null);
    setError("");
    if (!load) return;
    const current = { controller: new AbortController(), loading: false, seek: 0 };
    session.current = current;
    open(current);
    return () => { current.controller.abort(); session.current = null; };
  }, [load]);

  async function refill(force = false, allowCycle = false) {
    const current = session.current;
    if (!current || current.loading || !deck || (!deck.next && (singleTitle || !allowCycle || !deck.paged))) return;
    const remaining = deck.fresh.filter(card => !matched.current.has(card.id));
    const remainingPrompts = contextual ? remaining.filter(card => card.examples?.length) : remaining;
    if (!force && remainingPrompts.length > refillAt) return;
    const { signal } = current.controller;
    const seek = current.seek;
    current.loading = true;
    setError("");
    try {
      const recent = deck.cards.filter(card => matched.current.has(card.id)).slice(-refillAt);
      const review = singleTitle ? [] : selectedReviewIds(progress, deck.membership, new Set(remaining.map(card => card.id)), Date.now());
      const result = await load("practice-page", { after: deck.next, review, continuation: deck.continuation }, signal);
      if (signal.aborted || seek !== current.seek) return;
      if (!deck.next) matched.current.clear();
      const retainedFresh = singleTitle ? remaining
        : uniqueCards([...remainingPrompts, ...remaining]).slice(0, refillAt);
      const fresh = uniqueCards([...retainedFresh, ...result.cards.map(toPracticeCard)]);
      const cards = uniqueCards([...fresh, ...recent, ...result.reviews.map(toPracticeCard)]);
      const retained = new Set(cards.map(card => card.id));
      matched.current = new Set([...matched.current].filter(id => retained.has(id)));
      setDeck(previous => ({ ...previous, fresh, cards, next: result.next, continuation: result.continuation }));
    } catch (failure) {
      if (!signal.aborted && seek === current.seek) setError(failure.message);
    } finally {
      if (seek === current.seek) current.loading = false;
    }
  }

  async function jump(after, selectQuestion) {
    const current = session.current;
    if (!current || !deck) return;
    const { signal } = current.controller;
    const seek = ++current.seek;
    current.loading = true;
    try {
      const result = await load("practice-page", { after }, signal);
      if (signal.aborted || seek !== current.seek) return;
      const fresh = result.cards.map(toPracticeCard);
      const cards = uniqueCards([...deck.fresh, ...fresh]);
      const question = selectQuestion(cards, fresh);
      if (!question) throw new Error("Couldn’t open a question at that subtitle.");
      matched.current.clear();
      setError("");
      setDeck(previous => ({ ...previous, fresh, cards, next: result.next, continuation: result.continuation }));
      return question;
    } catch (failure) {
      if (!signal.aborted && seek === current.seek) throw failure;
    } finally {
      if (seek === current.seek) current.loading = false;
    }
  }

  function onAttempt(card) {
    matched.current.delete(card.id);
    matched.current.add(card.id);
    if (!error) void refill(false, true);
  }

  function record(card, word) {
    setDeck(previous => previous && ({ ...previous, membership: new Map(previous.membership)
      .set(word.id, practiceMembership(card, word.readingKey, word.meaningKey)) }));
  }

  function retry() {
    const current = session.current;
    if (!current || current.loading) return;
    if (deck) void refill(true, true);
    else void start(current, progress);
  }

  async function refreshedProgress(next) {
    const current = session.current;
    if (!current || !deck) return false;
    const { signal } = current.controller;
    const changed = checksFor(next).filter(([id, reading, meaning]) => {
      const prior = progress.get(id);
      return !deck.membership.has(id) || prior?.readingKey !== reading || prior?.meaningKey !== meaning;
    });
    const membership = await checkProgress(load, signal, changed, new Map());
    if (signal.aborted) return false;
    setDeck(previous => previous && ({ ...previous, membership: new Map([...previous.membership, ...membership]) }));
    return true;
  }

  return { deck, error, onAttempt, record, refill, jump, refreshedProgress, retry };
}
