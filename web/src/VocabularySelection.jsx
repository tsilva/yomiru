import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { episodeCode } from "./library-episodes.mjs";
import { combineVocabulary, exportVocabulary, vocabularyCacheKey, VocabularyCounts } from "./vocabulary-export.mjs";
import { VocabularyBrowser } from "./VocabularyBrowser.jsx";
import { sortVocabulary } from "./vocabulary-study.mjs";
import { loadShowEpisodes, showSelectionState, updateShowSelection } from "./show-selection.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);

export function ShowSelection({ group, publication }) {
  const { selected, selectShow, showCache } = useContext(Selection);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const checkbox = useRef(null);
  const show = group.id;
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
  }, [show, publication, retry, showCache]);
  const { selectable, checked, mixed } = showSelectionState(rows || [], selected);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = mixed; }, [mixed]);
  return <span className="show-selection">
    <label title={error || (!rows ? "Loading this show's episodes…" : `Select all ${selectable.length} episodes with vocabulary, including hidden episodes`)}>
      <input ref={checkbox} type="checkbox" className="vocabulary-selection__checkbox"
        aria-label={`Select all ${group.name} episodes`} checked={checked}
        disabled={!rows || !selectable.length} onChange={event => selectShow(selectable, event.target.checked)} />
    </label>
    {rows && rows.length > selectable.length && <small>{rows.length - selectable.length} awaiting vocabulary</small>}
    {error && <button type="button" title={error} onClick={() => setRetry(n => n + 1)}>Retry select all</button>}
  </span>;
}

export function EpisodeSelection({ row, id }) {
  const { selected, toggle } = useContext(Selection);
  const label = `${row.show} ${episodeCode(row.season, row.episode)}`;
  return <input id={id} type="checkbox" className="vocabulary-selection__checkbox"
    aria-label={`Select ${label} vocabulary`} checked={selected.has(row.id)}
    disabled={!row.vocabulary} title={row.vocabulary ? `Select ${label}` : "Vocabulary is not available for this episode yet"}
    onChange={() => toggle(row)} />;
}

function useEpisodeVocabulary(episodes) {
  const [documents, setDocuments] = useState(() => new Map());
  const [failed, setFailed] = useState(null);
  const [retry, setRetry] = useState(0);
  const [summary, setSummary] = useState(null);
  const [counts] = useState(() => new VocabularyCounts());

  const next = episodes.find(episode => !documents.has(vocabularyCacheKey(episode.vocabulary)));
  const { sha256, registry, anchor, words } = next?.vocabulary ?? {};
  const episodeId = next?.id;
  const request = useMemo(() => ({ episodeId, sha256, registry, anchor, words, retry }),
    [episodeId, sha256, registry, anchor, words, retry]);

  useEffect(() => {
    if (!request.episodeId) return;
    const controller = new AbortController();
    async function load() {
      const query = new URLSearchParams({ episode: request.episodeId, revision: request.sha256 });
      if (request.registry) query.set("registry", request.registry);
      const response = await fetch(`/api/vocabulary?${query}`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(response.status === 409
          ? "The library changed. Clear the selection and select the episodes again."
          : "Vocabulary is temporarily unavailable. Try again.");
      }
      const document = await response.json();
      if (document.anchor !== request.anchor || (request.registry && document.registry !== request.registry)
        || !Array.isArray(document.words) || document.words.length !== request.words) {
        throw new Error("Vocabulary could not be verified. Try again.");
      }
      if (controller.signal.aborted) return;
      setDocuments(previous => new Map(previous).set(vocabularyCacheKey(request), document));
    }
    void load().catch(problem => {
      if (!controller.signal.aborted) setFailed({ request, message: problem.message });
    });
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    const keys = new Set(episodes.map(episode => vocabularyCacheKey(episode.vocabulary)));
    setDocuments(previous => {
      const retained = [...previous].filter(([key]) => keys.has(key));
      return retained.length === previous.size ? previous : new Map(retained);
    });
  }, [episodes]);

  useEffect(() => {
    setSummary({ episodes, ...counts.update(episodes, documents) });
  }, [episodes, documents, counts]);

  return { documents, summary, error: failed?.request === request ? failed.message : "",
    retryLoad: () => setRetry(n => n + 1) };
}

export function VocabularySelection({ children }) {
  const [selected, setSelected] = useState(() => new Map());
  const [language, setLanguage] = useState("eng");
  const [order, setOrder] = useState("frequency");
  const [browsing, setBrowsing] = useState(false);
  const showCache = useRef(new Map());
  const episodes = useMemo(() => [...selected.values()], [selected]);
  const { documents, summary, error, retryLoad } = useEpisodeVocabulary(episodes);

  const ready = summary?.episodes === episodes && summary.loaded === episodes.length;
  const languages = useMemo(() => [...new Map(episodes.flatMap(e => e.translations).map(l => [l.code, l])).values()],
    [episodes]);
  const target = languages.some(l => l.code === language) ? language : languages[0]?.code || "eng";
  const total = ready ? summary.total : 0;
  const missing = ready ? total - (summary.covered.get(target) ?? 0) : 0;
  const canStudy = ready && total > 0 && !error;
  const words = useMemo(() => browsing && canStudy ? sortVocabulary(combineVocabulary(episodes, documents, target), order) : null,
    [browsing, canStudy, episodes, documents, target, order]);
  const episodeLabel = `${selected.size} episode${selected.size === 1 ? "" : "s"}`;
  const meaningsControl = <label><span>Meanings</span> <select value={target} onChange={event => setLanguage(event.target.value)}>
    {(languages.length ? languages : [{ code: "eng", label: "English" }]).map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
  </select></label>;
  function toggle(row) {
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
      return next;
    });
  }
  function downloadCsv() {
    const content = exportVocabulary(words ?? sortVocabulary(combineVocabulary(episodes, documents, target), order), target);
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `yomiru-vocabulary-${target}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Let the browser acquire the object before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selectShow(rows, checked) {
    setSelected(previous => updateShowSelection(previous, rows, checked));
  }
  return <Selection.Provider value={{ selected, toggle, selectShow, showCache }}>
    {selected.size > 0 && <div className="vocabulary-selection" role="region" aria-label="Vocabulary download">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <strong>{ready ? `${total.toLocaleString()} unique ${total === 1 ? "word" : "words"}` : error ? "Word count unavailable" : "Counting words…"}</strong>
        <span>{episodeLabel} selected</span>
      </div>
      <div className="vocabulary-selection__actions">
        {meaningsControl}
        <button disabled={!canStudy} aria-haspopup="dialog" onClick={() => setBrowsing(true)}>Browse words</button>
        <button className="vocabulary-selection__download" disabled={!canStudy} onClick={downloadCsv}>Download CSV</button>
        <button className="vocabulary-selection__clear" onClick={() => setSelected(new Map())}>Clear selection</button>
      </div>
      <div className="vocabulary-selection__notes">
        <p className="vocabulary-selection__note">
          Meanings come from the shared master vocabulary. <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">JMdict / JMnedict · EDRDG</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
        </p>
        {error
          ? <p className="vocabulary-selection__note" role="alert">{error} <button onClick={retryLoad}>Try again</button></p>
          : <p className="vocabulary-selection__note" style={{ visibility: missing ? "visible" : "hidden" }}>
            {missing.toLocaleString()} {missing === 1 ? "word" : "words"} without a meaning.
          </p>}
      </div>
    </div>}
    {words && <VocabularyBrowser words={words} episodeCount={selected.size} onClose={() => setBrowsing(false)}
      order={order} onOrderChange={setOrder} meaningsControl={meaningsControl} onDownload={downloadCsv} />}
    {children}
  </Selection.Provider>;
}
