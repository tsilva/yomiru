import { useEffect, useMemo, useState } from "react";
import { masteryBatchSize, vocabularyProgressForWords } from "./library-mastery.mjs";
import { presentedWords } from "./vocabulary-practice.mjs";
import { practiceEligibility } from "./practice-deck.mjs";
import { readPracticeProgress } from "./vocabulary-practice-storage.mjs";

const empty = new Map();
const emptyWords = [];
const libraryKey = "selection:";

function planRequest(publication, entries, catalogue) {
  const titles = (catalogue?.titles ?? []).filter(id => !entries.has(`title:${id}`));
  const groups = (catalogue?.groups ?? []).filter(id => !entries.has(`group:${id}`));
  const selection = entries.has(libraryKey) ? undefined : "all";
  return selection || titles.length || groups.length ? JSON.stringify({ publication, selection,
    titles: titles.slice(0, masteryBatchSize).sort(), groups: groups.slice(0, masteryBatchSize).sort() }) : "";
}

async function loadMastery(body, signal) {
  const { publication, titles, groups, selection } = JSON.parse(body);
  const query = new URLSearchParams({ mode: "mastery", publication, eligibility: practiceEligibility });
  if (titles.length) query.set("titles", titles.join(","));
  if (groups.length) query.set("groups", groups.join(","));
  if (selection) query.set("selection", selection);
  const response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  if (response.status === 409 || (response.ok && response.headers.get("X-Yomiru-Publication") !== publication)) {
    return { stale: true };
  }
  if (!response.ok) throw new Error("Mastery is temporarily unavailable.");
  const { words, scopes } = await response.json();
  const values = new Map([
    ...titles.map(id => [`title:${id}`, []]), ...groups.map(id => [`group:${id}`, []]),
  ]);
  if (selection) values.set(libraryKey, emptyWords);
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
      void readPracticeProgress().then(words => {
        if (!current || request !== sequence) return;
        setProgress({ history: presentedWords(words) });
      }).catch(() => {
        if (current && request === sequence) setProgress({ error: "Practice history is unavailable." });
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => { current = false; window.removeEventListener("focus", refresh); };
  }, [active, exercising, attempt]);

  const entries = cache?.publication === publication ? cache.values : empty;
  const history = progress?.history;
  const body = publication && active && history?.size
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

  const emptyProgress = useMemo(() => history?.size === 0 && vocabularyProgressForWords(emptyWords, history), [history]);
  const cachedProgress = useMemo(() => {
    if (!history?.size) return empty;
    const result = new Map();
    for (const [key, words] of entries) {
      result.set(key, vocabularyProgressForWords(words, history));
    }
    return result;
  }, [entries, history]);
  const error = progress?.error || (failure?.body === body && failure.attempt === attempt ? failure.message : "");
  function progressFor(kind, id = "") {
    const key = `${kind}:${id}`;
    return cachedProgress.get(key) ?? (emptyProgress || (error ? null : undefined));
  }
  return {
    history, historyError: progress?.error, scopeError: failure?.body === body && failure.attempt === attempt ? failure.message : "",
    retry: () => retry(value => value + 1), progressFor,
    wordsFor: (kind, id = "") => entries.get(`${kind}:${id}`) ?? (emptyProgress ? emptyWords : undefined),
  };
}
