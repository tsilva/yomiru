import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { libraryGroupId, libraryTitle } from "./library-episodes.mjs";
import { LibraryPublicationChanged, loadShowEpisodes, readFavorites, refreshSelectedTitles, saveFavorites,
  showSelectionState, updateShowSelection } from "./show-selection.mjs";
import { formatMastery } from "./library-mastery.mjs";
import { useLibraryMastery } from "./use-library-mastery.mjs";
import { startMobilePracticeFullscreen } from "./mobile-display.mjs";
import { practicePageVersion, sharedPracticeSelectionLimit } from "./practice-deck.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);
const VocabularyBrowser = lazy(() => import("./VocabularyBrowser.jsx").then(module => ({ default: module.VocabularyBrowser })));
const VocabularyPractice = lazy(() => import("./VocabularyPractice.jsx").then(module => ({ default: module.VocabularyPractice })));
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

function FavoriteStar({ label, pressed, title, description, disabled, onClick }) {
  return <button type="button" className="vocabulary-selection__star" aria-label={label}
    aria-pressed={pressed} aria-description={description} title={title} disabled={disabled} onClick={onClick}>
    <span aria-hidden="true">{pressed === true ? "★" : "☆"}</span>
  </button>;
}

export function GroupFavorite({ group, publication, onPublicationChange }) {
  const { selected, toggleGroup, showCache } = useContext(Selection);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const pressed = mixed || (!rows && hasSelection) ? "mixed" : checked;
  const title = checked ? `Unstar all ${items} in ${group.name}` : `Star all ${items} with vocabulary in ${group.name}`;
  return <FavoriteStar label={`Favorite all titles in ${group.name}`} pressed={pressed}
    title={error || title} description={error || undefined}
    disabled={!publication || busy || Boolean(rows && !selectable.length)} onClick={async () => {
      setBusy(true);
      const request = active.current;
      const result = await ensureRows();
      if (request !== active.current || request?.controller.signal.aborted) return;
      if (result) toggleGroup(result);
      setBusy(false);
    }} />;
}

export function TitleFavorite({ row }) {
  const { selected, toggle } = useContext(Selection);
  const label = libraryTitle(row);
  const pressed = selected.has(row.id);
  return <FavoriteStar label={`Favorite ${label}`} pressed={pressed}
    disabled={!row.vocabulary}
    title={row.vocabulary ? `${pressed ? "Unstar" : "Star"} ${label}` : "Vocabulary is not available for this title yet"}
    onClick={() => toggle(row)} />;
}

export function ExerciseButton({ row, disabled }) {
  const { setExercise } = useContext(Selection);
  const label = row ? `Exercise for ${libraryTitle(row)}` : "Exercise";
  const unavailable = row && !row.vocabulary;
  return <button type="button" className="install subtitle-library__control"
    aria-label={label} title={unavailable ? "Vocabulary is not available for this title yet" : label}
    disabled={disabled || unavailable} aria-haspopup="dialog"
    onClick={event => setExercise({ trigger: event.currentTarget, titleId: row?.id,
      endFullscreen: startMobilePracticeFullscreen() })}>
    <span className="install__face" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <g transform="rotate(-42 12 12)">
          <rect x="2" y="11" width="20" height="2" rx="1" />
          <rect x="2" y="8.5" width="2.5" height="7" rx="1" />
          <rect x="5.5" y="5.5" width="3.5" height="13" rx="1.25" />
          <rect x="15" y="5.5" width="3.5" height="13" rx="1.25" />
          <rect x="19.5" y="8.5" width="2.5" height="7" rx="1" />
        </g>
      </svg>
    </span>
  </button>;
}

async function requestVocabulary(body, signal) {
  const { mode, publication, practice, titles, order } = JSON.parse(body);
  const firstPractice = publication && mode === "practice-page" && order !== "subtitle" && !practice.after && !practice.checks?.length
    && !practice.review?.length && titles.length <= sharedPracticeSelectionLimit;
  let response;
  if (firstPractice) {
    const query = new URLSearchParams({
      mode, publication, format: practicePageVersion, titles: [...titles].sort().join(","),
    });
    response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  } else {
    response = await fetch("/api/vocabulary-selection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
    });
  }
  if (response.ok) return response;
  if (response.status === 409) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
  throw new Error("Vocabulary is temporarily unavailable.");
}

function useVocabularySummary(body) {
  const [results, setResults] = useState(() => new Map());
  const [retry, setRetry] = useState(0);
  const hasCachedResult = useEffectEvent((key, attempt) => results.get(key)?.retry === attempt);
  useEffect(() => {
    if (!body || hasCachedResult(body, retry)) return;
    const controller = new AbortController();
    const { signal } = controller;
    function settle(result) {
      if (signal.aborted) return;
      setResults(previous => {
        const next = new Map(previous);
        next.delete(body);
        next.set(body, { retry, ...result });
        if (next.size > summaryCacheSize) next.delete(next.keys().next().value);
        return next;
      });
    }
    async function load() {
      try {
        const response = await requestVocabulary(body, signal);
        const value = await response.json();
        settle({ value, responsePublication: response.headers.get("X-Yomiru-Publication") });
      } catch (error) {
        settle({ error: error.message, stale: error instanceof LibraryPublicationChanged });
      }
    }
    const timer = setTimeout(load, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, retry]);
  const current = results.get(body);
  return { ...(current?.retry === retry || current?.value ? current : {}),
    retryLoad: () => setRetry(value => value + 1) };
}

export function VocabularySelection({ children, publication, onPublicationChange, masteryScopes, active }) {
  const [selected, setSelected] = useState(readFavorites);
  useEffect(() => { saveFavorites(selected); }, [selected]);
  const [columnSort, setColumnSort] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const [exercise, setExercise] = useState(null);
  useEffect(() => exercise?.endFullscreen, [exercise]);
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
  const episodes = useMemo(() => [...selected.values()], [selected]);
  const selection = useMemo(() => episodes.map(({ id }) => id), [episodes]);
  const hasFavorites = selection.length > 0;
  const selectionError = hasFavorites && !resolving && resolution?.error;
  const summaryBody = useMemo(() => JSON.stringify({
    mode: "summary", scope: "titles", publication, titles: [...selection].sort(),
  }), [publication, selection]);
  const summaryRequest = useVocabularySummary(hasFavorites && publication && !resolving && !selectionError
    ? summaryBody : "");
  useEffect(() => {
    if (publication && (summaryRequest.stale || (summaryRequest.responsePublication
      && summaryRequest.responsePublication !== publication))) onPublicationChange(publication);
  }, [publication, summaryRequest.stale, summaryRequest.responsePublication, onPublicationChange]);
  const { value: summary } = summaryRequest;
  const error = selectionError || summaryRequest.error;
  const ready = Boolean(summary);
  const total = summary?.total ?? 0;
  const masterySelection = useMemo(() => hasFavorites && !resolving && !error
    ? [...selection].sort() : null, [hasFavorites, resolving, error, selection]);
  const masteryGroup = useMemo(() => {
    if (episodes.length < 2 || !publication || resolving || error) return null;
    const group = libraryGroupId(episodes[0]);
    const rows = showCache.current.get(`${group}:${publication}`);
    if (!rows || !episodes.every(row => libraryGroupId(row) === group)) return null;
    const readyIds = rows.filter(row => row.vocabulary).map(row => row.id);
    return readyIds.length === episodes.length && readyIds.every(id => selected.has(id)) ? group : null;
  }, [episodes, publication, resolving, error, selected]);
  const mastery = useLibraryMastery({ catalogue: masteryScopes, publication, selection: masterySelection,
    selectionGroup: masteryGroup, active, exercising: Boolean(exercise), onPublicationChange });
  let masteryLabel;
  if (total > 0) {
    const score = mastery.selectionScore;
    if (typeof score === "number") masteryLabel = `${formatMastery(score)} mastery`;
    else if (score === "unpracticed") masteryLabel = "Mastery (not practiced)";
    else if (score === null || mastery.error) masteryLabel = "Mastery unavailable";
    else masteryLabel = "Measuring mastery…";
  }
  const missing = ready ? total - (summary.covered.eng ?? 0) : 0;
  const canStudy = ready && total > 0;
  const pageScope = JSON.stringify({ scope: "titles", publication, titles: selection });
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
  const exerciseTitleId = exercise?.titleId;
  const practiceScope = exerciseTitleId
    ? JSON.stringify({ scope: "titles", publication, titles: [exerciseTitleId] })
    : pageScope;
  const loadDeck = useCallback(async (mode, practice, signal) => {
    try {
      const order = exerciseTitleId && mode === "practice-page" ? "subtitle" : undefined;
      const options = mode === "practice-translation" ? { cue: practice } : { practice, order };
      const response = await requestVocabulary(JSON.stringify({ ...JSON.parse(practiceScope), mode, ...options }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged();
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [practiceScope, publication, onPublicationChange, exerciseTitleId]);
  const titleCount = selected.size;
  const movieCount = episodes.filter(row => row.type === "movie").length;
  const titleKind = movieCount ? (movieCount === titleCount ? "movie" : "title") : "episode";
  const countLabel = `${titleCount} ${titleKind}${titleCount === 1 ? "" : "s"}`;
  function toggle(row) {
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
      return next;
    });
  }
  function toggleGroup(rows) {
    setSelected(previous => updateShowSelection(previous, rows, !showSelectionState(rows, previous).checked));
  }
  const summaryBar = (
    <div className="vocabulary-selection" role="region" aria-label="Favorites vocabulary">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <div className="vocabulary-selection__metrics">
          <strong>{!hasFavorites ? "No favorites yet" : ready
            ? `${total.toLocaleString()} unique ${total === 1 ? "word" : "words"}`
            : error ? "Word count unavailable" : "Counting words…"}</strong>
          {masteryLabel && <strong className="vocabulary-selection__mastery">
            <span aria-hidden="true" className="vocabulary-selection__metric-separator">·</span>{masteryLabel}
          </strong>}
        </div>
        <span>
          {hasFavorites ? `${countLabel} starred` : "Star an episode or movie to study its vocabulary."}
          {missing > 0 && ` · ${missing.toLocaleString()} ${missing === 1 ? "word" : "words"} without an English meaning.`}
        </span>
      </div>
      <div className="vocabulary-selection__actions">
        <ExerciseButton disabled={!canStudy} />
        <button type="button" className="install subtitle-library__control" aria-label="Browse words" title="Browse words"
          disabled={!canStudy} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          <span className="install__face" aria-hidden="true">
            <svg className="subtitle-library__book" viewBox="0 0 24 24" focusable="false">
              <path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14" />
            </svg>
          </span>
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
  return <Selection.Provider value={{ selected, toggle, toggleGroup, showCache, setExercise }}>
    {children(summaryBar, mastery.scoreFor)}
    <Suspense fallback={null}>
      {browsing && canStudy && <VocabularyBrowser loadPage={loadPage} total={total} countLabel={countLabel}
        onClose={() => setBrowsing(false)} columnSort={columnSort} onColumnSort={setColumnSort} />}
      {exercise && <VocabularyPractice key={practiceScope} loadDeck={exerciseTitleId || ready ? loadDeck : null}
        singleTitle={Boolean(exerciseTitleId)} error={exerciseTitleId ? undefined : error} onRetry={summaryRequest.retryLoad}
        onClose={() => {
          setExercise(null);
          requestAnimationFrame(() => exercise.trigger.focus({ preventScroll: true }));
        }} />}
    </Suspense>
  </Selection.Provider>;
}
