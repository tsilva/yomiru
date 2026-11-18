import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { libraryTitle } from "./library-episodes.mjs";
import { VocabularyBrowser } from "./VocabularyBrowser.jsx";
import { loadShowEpisodes, showSelectionState, updateShowSelection } from "./show-selection.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);
const emptyWords = [];
const summaryCacheMs = 30_000;
const summaryCacheSize = 12;

export function ShowSelection({ group, publication }) {
  const { selected, selectShow, showCache } = useContext(Selection);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const checkbox = useRef(null);
  const show = group.id;
  const items = group.movie ? "movies" : "episodes";
  useEffect(() => {
    if (!publication) return;
    const controller = new AbortController();
    const key = `${show}:${publication}`;
    setError("");
    setRows(null);
    const cached = showCache.current.get(key);
    if (cached) { setRows(cached); return; }
    void loadShowEpisodes(show, publication, { signal: controller.signal }).then(episodes => {
      if (controller.signal.aborted) return;
      showCache.current.set(key, episodes);
      if (showCache.current.size > 10) showCache.current.delete(showCache.current.keys().next().value);
      setRows(episodes);
    }).catch(problem => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [show, publication, showCache]);
  const { selectable, checked, mixed } = showSelectionState(rows || [], selected);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = mixed; }, [mixed]);
  return <span className="show-selection">
    <label title={error || (!rows ? `Loading ${items}…` : `Select all ${selectable.length} ${items} with vocabulary, including hidden ${items}`)}>
      <input ref={checkbox} type="checkbox" className="vocabulary-selection__checkbox"
        aria-label={`Select all ${group.name}${group.name === "Movies" ? "" : ` ${items}`}`} checked={checked}
        aria-description={error || undefined}
        disabled={!rows || !selectable.length} onChange={event => selectShow(selectable, event.target.checked)} />
    </label>
    {rows && rows.length > selectable.length && <small>{rows.length - selectable.length} awaiting vocabulary</small>}
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
  const response = await fetch("/api/vocabulary-selection", {
    method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
  });
  if (response.ok) return response;
  throw new Error(response.status === 409
    ? "The library changed. Reload the page to refresh vocabulary."
    : "Vocabulary is temporarily unavailable. Try again.");
}

function useVocabularyRequest(body, cacheSummary = false) {
  const [results, setResults] = useState(() => new Map());
  const [retry, setRetry] = useState(0);
  const hasFreshSummary = useEffectEvent((key, attempt) => {
    const entry = results.get(key);
    return entry?.retry === attempt && Date.now() - entry.loadedAt < summaryCacheMs;
  });
  useEffect(() => {
    if (!body || (cacheSummary && hasFreshSummary(body, retry))) return;
    const controller = new AbortController();
    const { signal } = controller;
    function settle(result) {
      if (signal.aborted) return;
      setResults(previous => {
        const next = cacheSummary ? new Map(previous) : new Map();
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
        settle({ value, loadedAt: Date.now() });
      } catch (error) {
        settle({ error: error.message });
      }
    }
    void load();
    return () => controller.abort();
  }, [body, cacheSummary, retry]);
  const current = results.get(body);
  return { ...(current?.retry === retry ? current : {}),
    retryLoad: () => setRetry(value => value + 1) };
}

export function VocabularySelection({ children }) {
  const [selected, setSelected] = useState(() => new Map());
  const [columnSort, setColumnSort] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const showCache = useRef(new Map());
  const episodes = useMemo(() => [...selected.values()], [selected]);
  const selection = useMemo(() => episodes.map(({ id, vocabulary }) => ({
    id, revision: vocabulary.sha256, registry: vocabulary.registry,
  })), [episodes]);
  const all = !selection.length;
  const summaryBody = useMemo(() => JSON.stringify(all ? { mode: "summary", scope: "all" } : {
    mode: "summary", episodes: [...selection].sort((a, b) => a.id.localeCompare(b.id)),
  }), [all, selection]);
  const { value: summary, error, retryLoad } = useVocabularyRequest(summaryBody, true);
  const ready = Boolean(summary);
  const total = summary?.total ?? 0;
  const missing = ready ? total - (summary.covered.eng ?? 0) : 0;
  const canStudy = ready && total > 0;
  const detailScope = all ? { scope: "all", publication: summary?.publication } : { episodes: selection };
  const study = useVocabularyRequest(browsing && canStudy
    ? JSON.stringify({ mode: "study", ...detailScope }) : "");
  const words = study.value?.words ?? emptyWords;
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
  return <Selection.Provider value={{ selected, toggle, selectShow, showCache }}>
    <div className="vocabulary-selection" role="region" aria-label="Vocabulary selection">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <strong>{ready ? `${total.toLocaleString()} unique ${total === 1 ? "word" : "words"}` : error ? "Word count unavailable" : "Counting words…"}</strong>
        <span>
          {scopeLabel}
          {missing > 0 && ` · ${missing.toLocaleString()} ${missing === 1 ? "word" : "words"} without an English meaning.`}
        </span>
      </div>
      <div className="vocabulary-selection__actions">
        <button type="button" aria-label="Browse words" title="Browse words"
          disabled={!canStudy} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14" />
          </svg>
        </button>
      </div>
      {error && <p className="vocabulary-selection__note" role="alert">
        {error} <button type="button" onClick={retryLoad}>Try again</button>
      </p>}
    </div>
    {browsing && canStudy && <VocabularyBrowser words={words} total={total} countLabel={countLabel}
      loading={!study.value && !study.error} error={study.error} onRetry={study.retryLoad}
      onClose={() => setBrowsing(false)}
      columnSort={columnSort} onColumnSort={setColumnSort}
      onDownload={downloadCsv} downloading={downloading} downloadError={downloadError} />}
    {children}
  </Selection.Provider>;
}
