import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { libraryGroupId, libraryTitle } from "./library-episodes.mjs";
import { VocabularyBrowser } from "./VocabularyBrowser.jsx";
import { VocabularyPractice } from "./VocabularyPractice.jsx";
import { LibraryPublicationChanged, loadShowEpisodes, refreshSelectedTitles, showSelectionState,
  updateShowSelection } from "./show-selection.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);
const emptyWords = [];
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
  const checkbox = useRef(null);
  const show = group.id;
  const items = group.movie ? "movies" : "episodes";
  useEffect(() => {
    if (!publication) return;
    const controller = new AbortController();
    const { signal } = controller;
    void groupRows(show, publication, showCache.current, signal).then(episodes => {
      if (!signal.aborted) setRows(episodes);
    }).catch(problem => {
      if (signal.aborted) return;
      if (problem instanceof LibraryPublicationChanged && onPublicationChange(publication)) return;
      setError(problem.message);
    });
    return () => controller.abort();
  }, [show, publication, showCache, onPublicationChange]);
  const { selectable, checked, mixed } = showSelectionState(rows || [], selected);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = mixed; }, [mixed]);
  return <span className="show-selection">
    <label title={error || (!rows ? `Loading ${items}…` : `Select all ${selectable.length} ${items} with vocabulary, including hidden ${items}`)}>
      <input ref={checkbox} type="checkbox" className="vocabulary-selection__checkbox"
        aria-label={`Select all ${group.name}${group.movie && group.name.endsWith("Movies") ? "" : ` ${items}`}`}
        checked={checked}
        aria-description={error || undefined}
        disabled={!rows || !selectable.length} onChange={event => selectShow(selectable, event.target.checked)} />
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
  const { scope, mode, publication, page, sort } = JSON.parse(body);
  const publicRead = scope === "all" && publication && (mode === "practice"
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

function useVocabularyRequest(body, cacheSummary = false, publication = "", initial, reuseRevision = false) {
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
        if (Array.isArray(value.words?.[0])) {
          value.words = value.words.map(([id, word, reading, romaji, pos, meanings, count]) =>
            ({ id, word, reading, romaji, pos, meanings, count }));
        }
        settle({ value, responsePublication: response.headers.get("X-Yomiru-Publication"), loadedAt: Date.now() });
      } catch (error) {
        settle({ error: error.message, stale: error instanceof LibraryPublicationChanged });
      }
    }
    void load();
    return () => controller.abort();
  }, [body, cacheSummary, key, retry, initOnFirstAttempt, reuseRevision]);
  const current = results.get(key)
    ?? (initOnFirstAttempt ? { retry: 0, value: initial, responsePublication: publication } : undefined);
  return { ...(current?.retry === retry || (cacheSummary && current?.value) ? current : {}),
    retryLoad: () => setRetry(value => value + 1) };
}

export function VocabularySelection({ children, publication, initialSummary, onPublicationChange }) {
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
    true, publication, all ? initialSummary : undefined);
  useEffect(() => {
    if (publication && (summaryRequest.stale || (summaryRequest.responsePublication
      && summaryRequest.responsePublication !== publication))) onPublicationChange(publication);
  }, [publication, summaryRequest.stale, summaryRequest.responsePublication, onPublicationChange]);
  const { value: summary } = summaryRequest;
  const error = selectionError || summaryRequest.error;
  const ready = Boolean(summary);
  const total = summary?.total ?? 0;
  const missing = ready ? total - (summary.covered.eng ?? 0) : 0;
  const canStudy = ready && total > 0;
  const detailScope = all ? { scope: "all", publication: summary?.publication }
    : { scope: "titles", publication, titles: selection };
  const pageScope = JSON.stringify(detailScope);
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
  const study = useVocabularyRequest(exercising && canStudy
    ? JSON.stringify({ mode: "practice", ...detailScope }) : "", false, publication, undefined, true);
  useEffect(() => {
    if (publication && (study.stale || (study.responsePublication && study.responsePublication !== publication))) {
      onPublicationChange(publication);
    }
  }, [publication, study.stale, study.responsePublication, onPublicationChange]);
  const checkPublication = useEffectEvent(async signal => {
    if (!publication || document.hidden) return;
    const response = await fetch("/api/browse", { method: "HEAD", signal, cache: "no-store" });
    if (response.ok && response.headers.get("X-Yomiru-Publication") !== publication) {
      onPublicationChange(publication);
    }
  });
  useEffect(() => {
    if (!exercising) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void checkPublication(controller.signal).catch(() => {});
    }, summaryCacheMs * 2);
    return () => { clearInterval(timer); controller.abort(); };
  }, [exercising]);
  const download = useRef(null);
  const [downloadState, setDownloadState] = useState(null);
  const downloadBody = JSON.stringify({ mode: "csv", ...detailScope, sort: columnSort ?? undefined });
  useEffect(() => {
    setDownloadState(null);
    return () => download.current?.abort();
  }, [downloadBody]);
  const downloading = downloadState?.body === downloadBody && downloadState.pending;
  const downloadError = downloadState?.body === downloadBody && downloadState.error;
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
  async function downloadCsv() {
    download.current?.abort();
    const controller = new AbortController();
    download.current = controller;
    setDownloadState({ body: downloadBody, pending: true });
    try {
      const response = await requestVocabulary(downloadBody, controller.signal);
      const content = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(content);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "yomiru-vocabulary-eng.csv";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadState(null);
    } catch (problem) {
      if (!controller.signal.aborted) setDownloadState({ body: downloadBody, error: problem.message });
    }
  }
  function selectShow(rows, checked) {
    setSelected(previous => updateShowSelection(previous, rows, checked));
  }
  const summaryBar = (
    <div className="vocabulary-selection" role="region" aria-label="Vocabulary selection">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <strong>{ready ? `${total.toLocaleString()} unique ${total === 1 ? "word" : "words"}` : error ? "Word count unavailable" : "Counting words…"}</strong>
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
    </div>
  );
  return <Selection.Provider value={{ selected, toggle, selectShow, showCache }}>
    {children(summaryBar)}
    {browsing && canStudy && <VocabularyBrowser loadPage={loadPage} total={total} countLabel={countLabel}
      onClose={() => setBrowsing(false)}
      columnSort={columnSort} onColumnSort={setColumnSort}
      onDownload={downloadCsv} downloading={downloading} downloadError={downloadError} />}
    {exercising && <VocabularyPractice words={study.value?.words ?? (ready && !total ? emptyWords : null)}
      error={study.error || error} onRetry={study.error ? study.retryLoad : summaryRequest.retryLoad}
      onClose={() => { setExercising(false); requestAnimationFrame(() => exerciseButton.current?.focus()); }} />}
  </Selection.Provider>;
}
