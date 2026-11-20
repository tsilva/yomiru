import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { libraryGroupId, libraryTitle } from "./library-episodes.mjs";
import { LibraryPublicationChanged, loadShowEpisodes, refreshSelectedTitles, showSelectionState,
  updateShowSelection } from "./show-selection.mjs";
import { formatMastery } from "./library-mastery.mjs";
import { useLibraryMastery } from "./use-library-mastery.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);
const VocabularyBrowser = lazy(() => import("./VocabularyBrowser.jsx").then(module => ({ default: module.VocabularyBrowser })));
const VocabularyPractice = lazy(() => import("./VocabularyPractice.jsx").then(module => ({ default: module.VocabularyPractice })));
const summaryCacheMs = 30_000;
const summaryCacheSize = 12;

async function groupRows(show, publication, cache, signal) {
  const key = `${show}:${publication}`;
  if (cache.has(key)) return cache.get(key);
  const rows = await loadShowEpisodes(show, publication, { signal });
  if (!signal.aborted) {
    cache.set(key, rows);
    if (cache.size > 10) cache.delete(cache.keys().next().value);
  }
  return rows;
}

export function ShowSelection({ group, publication, onPublicationChange }) {
  const { selected, selectShow, showCache } = useContext(Selection);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const checkbox = useRef(null);
  const active = useRef(null);
  const show = group.id;
  const items = group.movie ? "movies" : "episodes";
  useEffect(() => {
    const controller = new AbortController();
    active.current = { controller, promise: null };
    setRows(showCache.current.get(`${show}:${publication}`) ?? null);
    setError("");
    setBusy(false);
    return () => controller.abort();
  }, [show, publication, showCache]);
  async function ensureRows() {
    if (rows) return rows;
    const request = active.current;
    if (!request || !publication) return;
    const { signal } = request.controller;
    request.promise ??= groupRows(show, publication, showCache.current, signal).then(result => {
      if (!signal.aborted) { setRows(result); setError(""); return result; }
    }).catch(problem => {
      if (signal.aborted) return;
      if (problem instanceof LibraryPublicationChanged && onPublicationChange(publication)) return;
      setError(problem.message);
    }).finally(() => { request.promise = null; });
    return request.promise;
  }
  const hasSelection = [...selected.values()].some(row => libraryGroupId(row) === show);
  const resolveSelectedGroup = useEffectEvent(() => { void ensureRows(); });
  useEffect(() => {
    if (hasSelection && !rows) resolveSelectedGroup();
  }, [hasSelection, rows, publication]);
  const { selectable, checked, mixed } = showSelectionState(rows || [], selected);
  const indeterminate = mixed || (!rows && hasSelection);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = indeterminate; }, [indeterminate]);
  return <span className="show-selection">
    <label title={error || `Select all ${items} with vocabulary, including hidden ${items}`}>
      <input ref={checkbox} type="checkbox" className="vocabulary-selection__checkbox"
        aria-label={`Select all ${group.name}${group.movie && group.name.endsWith("Movies") ? "" : ` ${items}`}`}
        checked={checked}
        aria-description={error || undefined}
        disabled={!publication || busy || Boolean(rows && !selectable.length)} onChange={async () => {
          setBusy(true);
          const result = await ensureRows();
          if (!result || active.current?.controller.signal.aborted) { setBusy(false); return; }
          const state = showSelectionState(result, selected);
          selectShow(state.selectable, !state.checked);
          setBusy(false);
        }} />
    </label>
  </span>;
}

export function TitleSelection({ row, id }) {
  const { selected, toggle } = useContext(Selection);
  const label = libraryTitle(row);
  return <input id={id} type="checkbox" className="vocabulary-selection__checkbox"
    aria-label={`Select ${label} vocabulary`} checked={selected.has(row.id)}
    disabled={!row.vocabulary} title={row.vocabulary ? `Select ${label}` : "Vocabulary is not available for this title yet"}
    onChange={() => toggle(row)} />;
}

async function requestVocabulary(body, signal) {
  const { scope, mode, publication, page, sort, practice } = JSON.parse(body);
  const publicRead = scope === "all" && publication && ((mode === "practice-page" && !practice.after
    && !practice.checks?.length && !practice.review?.length)
    || (mode === "page" && page.offset === 0 && !page.query && !page.category && !sort));
  const response = publicRead
    ? await fetch(`/api/vocabulary-selection?${new URLSearchParams({ mode, publication })}`, { signal })
    : await fetch("/api/vocabulary-selection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
    });
  if (response.ok) return response;
  if (response.status === 409) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
  throw new Error("Vocabulary is temporarily unavailable.");
}

function useVocabularyRequest(body, cacheSummary = false, publication = "", initial, reuseRevision = false,
  delayMs = 0) {
  const [results, setResults] = useState(() => new Map());
  const [retry, setRetry] = useState(0);
  const key = `${publication}:${body}`;
  const initOnFirstAttempt = Boolean(initial && initial.publication === publication);
  const hasFreshSummary = useEffectEvent((key, attempt) => {
    const entry = results.get(key);
    return entry?.retry === attempt && (reuseRevision || Date.now() - entry.loadedAt < summaryCacheMs);
  });
  useEffect(() => {
    if (!body || (initOnFirstAttempt && retry === 0)
      || ((cacheSummary || reuseRevision) && hasFreshSummary(key, retry))) return;
    const controller = new AbortController();
    const { signal } = controller;
    function settle(result) {
      if (signal.aborted) return;
      setResults(previous => {
        const next = cacheSummary ? new Map(previous) : new Map();
        next.delete(key);
        next.set(key, { retry, ...result });
        if (next.size > summaryCacheSize) next.delete(next.keys().next().value);
        return next;
      });
    }
    async function load() {
      try {
        const response = await requestVocabulary(body, signal);
        const value = await response.json();
        settle({ value, responsePublication: response.headers.get("X-Yomiru-Publication"), loadedAt: Date.now() });
      } catch (error) {
        settle({ error: error.message, stale: error instanceof LibraryPublicationChanged });
      }
    }
    const timer = delayMs ? setTimeout(load, delayMs) : undefined;
    if (!timer) void load();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, cacheSummary, key, retry, initOnFirstAttempt, reuseRevision, delayMs]);
  const current = results.get(key)
    ?? (initOnFirstAttempt ? { retry: 0, value: initial, responsePublication: publication } : undefined);
  return { ...(current?.retry === retry || (cacheSummary && current?.value) ? current : {}),
    retryLoad: () => setRetry(value => value + 1) };
}

export function VocabularySelection({ children, publication, initialSummary, onPublicationChange, masteryScopes, active }) {
  const [selected, setSelected] = useState(() => new Map());
  const [columnSort, setColumnSort] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const [exercising, setExercising] = useState(false);
  const exerciseButton = useRef(null);
  const showCache = useRef(new Map());
  const [resolution, setResolution] = useState(null);
  const [resolveAttempt, setResolveAttempt] = useState(0);
  const refreshSelection = useEffectEvent(async (revision, signal) => {
    const groups = new Set([...selected.values()].map(libraryGroupId));
    const current = new Map(await Promise.all([...groups].map(async show => {
      const rows = await groupRows(show, revision, showCache.current, signal);
      return [show, new Map(rows.map(row => [row.id, row]))];
    })));
    if (!signal.aborted && current.size) setSelected(previous => refreshSelectedTitles(previous, current));
  });
  useEffect(() => {
    if (!publication) return;
    const controller = new AbortController();
    const { signal } = controller;
    const settle = error => {
      if (!signal.aborted) setResolution({ publication, attempt: resolveAttempt, error });
    };
    void refreshSelection(publication, signal).then(() => settle(""), error => {
      if (!signal.aborted && error instanceof LibraryPublicationChanged) onPublicationChange(publication);
      settle(error.message);
    });
    return () => controller.abort();
  }, [publication, resolveAttempt, onPublicationChange]);
  const resolving = publication && (resolution?.publication !== publication || resolution.attempt !== resolveAttempt);
  const selectionError = !resolving && resolution?.error;
  const episodes = useMemo(() => [...selected.values()], [selected]);
  const selection = useMemo(() => episodes.map(({ id }) => id), [episodes]);
  const all = !selection.length;
  const summaryBody = useMemo(() => JSON.stringify(all ? { mode: "summary", scope: "all" } : {
    mode: "summary", scope: "titles", publication, titles: [...selection].sort(),
  }), [all, publication, selection]);
  const summaryRequest = useVocabularyRequest(publication === null || resolving || selectionError ? "" : summaryBody,
    true, publication, all ? initialSummary : undefined, true, all ? 0 : 180);
  useEffect(() => {
    if (publication && (summaryRequest.stale || (summaryRequest.responsePublication
      && summaryRequest.responsePublication !== publication))) onPublicationChange(publication);
  }, [publication, summaryRequest.stale, summaryRequest.responsePublication, onPublicationChange]);
  const { value: summary } = summaryRequest;
  const error = selectionError || summaryRequest.error;
  const ready = Boolean(summary);
  const total = summary?.total ?? 0;
  const masterySelection = useMemo(() => !resolving && !error
    ? [...selection].sort() : null, [resolving, error, selection]);
  const masteryGroup = useMemo(() => {
    if (episodes.length < 2 || !publication || resolving || error) return null;
    const group = libraryGroupId(episodes[0]);
    const rows = showCache.current.get(`${group}:${publication}`);
    if (!rows || !episodes.every(row => libraryGroupId(row) === group)) return null;
    const readyIds = rows.filter(row => row.vocabulary).map(row => row.id);
    return readyIds.length === episodes.length && readyIds.every(id => selected.has(id)) ? group : null;
  }, [episodes, publication, resolving, error, selected]);
  const mastery = useLibraryMastery({ catalogue: masteryScopes, publication, selection: masterySelection,
    selectionGroup: masteryGroup, active, exercising, onPublicationChange });
  let masteryLabel;
  if (total > 0) {
    const score = mastery.selectionScore;
    if (typeof score === "number") masteryLabel = `${formatMastery(score)} selection mastery`;
    else if (score === "unpracticed") masteryLabel = "Selection mastery (not practiced)";
    else if (score === null || mastery.error) masteryLabel = "Selection mastery unavailable";
    else masteryLabel = "Measuring mastery…";
  }
  const missing = ready ? total - (summary.covered.eng ?? 0) : 0;
  const canStudy = ready && total > 0;
  const pageScope = JSON.stringify(all ? { scope: "all", publication: summary?.publication }
    : { scope: "titles", publication, titles: selection });
  const loadPage = useCallback(async (page, sort, signal) => {
    try {
      const response = await requestVocabulary(JSON.stringify({
        ...JSON.parse(pageScope), mode: "page", page, sort: sort ?? undefined,
      }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged();
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [pageScope, publication, onPublicationChange]);
  const loadDeck = useCallback(async (mode, practice, signal) => {
    try {
      const response = await requestVocabulary(JSON.stringify({ ...JSON.parse(pageScope), mode, practice }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged();
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [pageScope, publication, onPublicationChange]);
  const titleCount = all ? summary?.episodeCount ?? 0 : selected.size;
  const movieCount = all ? summary?.movieCount ?? 0 : episodes.filter(row => row.type === "movie").length;
  const titleKind = movieCount ? (movieCount === titleCount ? "movie" : "title") : "episode";
  const countLabel = `${titleCount} ${titleKind}${titleCount === 1 ? "" : "s"}`;
  const scopeLabel = all ? (titleCount ? `All ${countLabel}` : "All titles") : `${countLabel} selected`;
  function toggle(row) {
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
      return next;
    });
  }
  function selectShow(rows, checked) {
    setSelected(previous => updateShowSelection(previous, rows, checked));
  }
  const summaryBar = (
    <div className="vocabulary-selection" role="region" aria-label="Vocabulary selection">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <div className="vocabulary-selection__metrics">
          <strong>{ready ? `${total.toLocaleString()} unique ${total === 1 ? "word" : "words"}` : error ? "Word count unavailable" : "Counting words…"}</strong>
          {masteryLabel && <strong className="vocabulary-selection__mastery">
            <span aria-hidden="true" className="vocabulary-selection__metric-separator">·</span>{masteryLabel}
          </strong>}
        </div>
        <span>
          {scopeLabel}
          {missing > 0 && ` · ${missing.toLocaleString()} ${missing === 1 ? "word" : "words"} without an English meaning.`}
        </span>
      </div>
      <div className="vocabulary-selection__actions">
        <button ref={exerciseButton} type="button" className="vocabulary-selection__exercise"
          aria-label="Exercise" title="Exercise" disabled={!canStudy} aria-haspopup="dialog"
          onClick={() => setExercising(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <g transform="rotate(-42 12 12)">
              <rect x="2" y="11" width="20" height="2" rx="1" />
              <rect x="2" y="8.5" width="2.5" height="7" rx="1" />
              <rect x="5.5" y="5.5" width="3.5" height="13" rx="1.25" />
              <rect x="15" y="5.5" width="3.5" height="13" rx="1.25" />
              <rect x="19.5" y="8.5" width="2.5" height="7" rx="1" />
            </g>
          </svg>
        </button>
        <button type="button" aria-label="Browse words" title="Browse words"
          disabled={!canStudy} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14" />
          </svg>
        </button>
      </div>
      {error && <p className="vocabulary-selection__note" role="alert">
        {error} <button type="button" onClick={selectionError
          ? () => setResolveAttempt(value => value + 1) : summaryRequest.retryLoad}>Try again</button>
      </p>}
      {!error && mastery.error && <p className="vocabulary-selection__note" role="alert">
        {mastery.error} <button type="button" onClick={mastery.retry}>Try again</button>
      </p>}
    </div>
  );
  return <Selection.Provider value={{ selected, toggle, selectShow, showCache }}>
    {children(summaryBar, mastery.scoreFor)}
    <Suspense fallback={null}>
      {browsing && canStudy && <VocabularyBrowser loadPage={loadPage} total={total} countLabel={countLabel}
        onClose={() => setBrowsing(false)} columnSort={columnSort} onColumnSort={setColumnSort} />}
      {exercising && <VocabularyPractice key={pageScope} loadDeck={ready ? loadDeck : null}
        error={error} onRetry={summaryRequest.retryLoad}
        onClose={() => { setExercising(false); requestAnimationFrame(() => exerciseButton.current?.focus()); }} />}
    </Suspense>
  </Selection.Provider>;
}
