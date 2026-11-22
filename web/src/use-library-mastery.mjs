import { useEffect, useMemo, useState } from "react";
import { reviewedVocabularyProgress } from "./library-mastery.mjs";
import { presentedWords } from "./vocabulary-practice.mjs";
import { readPracticeProgress } from "./vocabulary-practice-storage.mjs";

const empty = new Map();
const scopeErrorMessage = "Vocabulary progress is temporarily unavailable.";

async function loadReviewedWords(publication, signal) {
  const query = new URLSearchParams({ mode: "practice-progress", publication });
  const response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  if (response.status === 409 || (response.ok && response.headers.get("X-Yomiru-Publication") !== publication)) {
    return null;
  }
  if (!response.ok) throw new Error(scopeErrorMessage);
  const { words, scopes } = await response.json();
  return new Map(scopes.map(([kind, id, indices]) => [
    `${kind}:${id}`, indices.map(index => words[index]),
  ]));
}

export function useLibraryMastery({ publication, active, exercising, onPublicationChange }) {
  const [progress, setProgress] = useState(null);
  const [roster, setRoster] = useState(null);
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

  useEffect(() => {
    if (!publication || !active) return;
    const controller = new AbortController();
    const { signal } = controller;
    void loadReviewedWords(publication, signal).then(entries => {
      if (signal.aborted) return;
      if (!entries) {
        onPublicationChange(publication);
        throw new Error(scopeErrorMessage);
      }
      setRoster({ publication, attempt, entries });
    }).catch(error => {
      if (!signal.aborted) setRoster({ publication, attempt, error: error.message });
    });
    return () => controller.abort();
  }, [active, publication, onPublicationChange, attempt]);

  const currentRoster = roster?.publication === publication && roster.attempt === attempt ? roster : null;
  const entries = currentRoster?.entries;
  const history = progress?.history;
  const scopeError = currentRoster?.error;
  const cachedProgress = useMemo(() => {
    if (!entries || !history) return empty;
    return new Map([...entries].map(([key, words]) => [key, reviewedVocabularyProgress(words, history)]));
  }, [entries, history]);

  function progressFor(kind, id = "") {
    return cachedProgress.get(`${kind}:${id}`)
      ?? (scopeError || progress?.error || (entries && history) ? null : undefined);
  }
  return {
    history, historyError: progress?.error, scopeError,
    retry: () => retry(value => value + 1), progressFor,
    wordsFor: (kind, id = "") => entries?.get(`${kind}:${id}`),
  };
}
