import { useEffect, useMemo, useState } from "react";
import { masteryBatchSize, masteryForWords } from "./library-mastery.mjs";
import { masteryAt, presentedWords } from "./vocabulary-practice.mjs";
import { practiceEligibility } from "./practice-deck.mjs";
import { readPracticeProgress } from "./vocabulary-practice-storage.mjs";

const empty = new Map();

function planRequest(publication, entries, catalogue) {
  const titles = (catalogue?.titles ?? []).filter(id => !entries.has(`title:${id}`));
  const groups = (catalogue?.groups ?? []).filter(id => !entries.has(`group:${id}`));
  return titles.length || groups.length ? JSON.stringify({ publication,
    titles: titles.slice(0, masteryBatchSize).sort(), groups: groups.slice(0, masteryBatchSize).sort() }) : "";
}

async function loadMastery(body, signal) {
  const { publication, titles, groups } = JSON.parse(body);
  const query = new URLSearchParams({ mode: "mastery", publication, eligibility: practiceEligibility });
  if (titles.length) query.set("titles", titles.join(","));
  if (groups.length) query.set("groups", groups.join(","));
  const response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  if (response.status === 409 || (response.ok && response.headers.get("X-Yomiru-Publication") !== publication)) {
    return { stale: true };
  }
  if (!response.ok) throw new Error("Mastery is temporarily unavailable.");
  const { words, scopes } = await response.json();
  const values = new Map([
    ...titles.map(id => [`title:${id}`, []]), ...groups.map(id => [`group:${id}`, []]),
  ]);
  for (const [kind, id, indices] of scopes) {
    const key = `${kind}:${id}`;
    if (values.has(key)) values.set(key, indices.map(index => words[index]));
  }
  return { values };
}

export function useLibraryMastery({ catalogue, publication, active, exercising, onPublicationChange }) {
  const [progress, setProgress] = useState(null);
  const [cache, setCache] = useState(null);
  const [failure, setFailure] = useState(null);
  const [attempt, retry] = useState(0);

  useEffect(() => {
    if (!active || exercising) return;
    let current = true;
    let sequence = 0;
    function refresh() {
      const request = ++sequence;
      const now = Date.now();
      void readPracticeProgress().then(words => {
        if (!current || request !== sequence) return;
        const scores = new Map();
        for (const [id, word] of words) {
          const score = masteryAt(word, now);
          if (score > 0) scores.set(id, score);
        }
        setProgress({ scores, history: presentedWords(words) });
      }).catch(() => {
        if (current && request === sequence) setProgress({ error: "Practice history is unavailable." });
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => { current = false; window.removeEventListener("focus", refresh); };
  }, [active, exercising, attempt]);

  const entries = cache?.publication === publication ? cache.values : empty;
  const body = publication && active && progress?.scores?.size
    ? planRequest(publication, entries, catalogue?.publication === publication ? catalogue : null)
    : "";
  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      try {
        const result = await loadMastery(body, signal);
        if (signal.aborted) return;
        if (result.stale) {
          onPublicationChange(publication);
          throw new Error("Mastery is temporarily unavailable.");
        }
        setFailure(null);
        setCache(previous => {
          const values = new Map(previous?.publication === publication ? previous.values : empty);
          for (const [key, words] of result.values) values.set(key, words);
          return { publication, values };
        });
      } catch (error) {
        if (!signal.aborted) setFailure({ body, attempt, message: error.message });
      }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [body, publication, onPublicationChange, attempt]);

  const scores = progress?.scores;
  const emptyProgress = Boolean(scores && !scores.size);
  const cachedScores = useMemo(() => {
    if (!scores?.size) return empty;
    const result = new Map();
    for (const [key, words] of entries) {
      result.set(key, masteryForWords(words, scores));
    }
    return result;
  }, [entries, scores]);
  const error = progress?.error || (failure?.body === body && failure.attempt === attempt ? failure.message : "");
  function scoreFor(kind, id) {
    if (emptyProgress) return "unpracticed";
    const key = `${kind}:${id}`;
    return cachedScores.has(key) ? cachedScores.get(key) : error ? null : undefined;
  }
  return { scores, history: progress?.history, historyError: progress?.error, retry: () => retry(value => value + 1), scoreFor };
}
