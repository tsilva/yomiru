import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { verbGroupLabels } from "./conjugation-guides.mjs";
import { loadVocabularyBatches, recoverLegacyVocabulary, rememberedVocabulary } from "./practice-history.mjs";
import { masteryAt, nextPracticeReviewAt } from "./vocabulary-practice.mjs";
import { orderVocabularyByMastery, orderVocabularyByNextReview } from "./vocabulary-mastery.mjs";
import {
  filterVocabulary, sortVocabulary, sortVocabularyByColumn, vocabularyCategories, vocabularyCategory, vocabularyColumns,
  vocabularyMeanings, vocabularyPageSize,
} from "./vocabulary-study.mjs";
import "./vocabulary-browser.css";

const empty = [];
const defaultSort = { column: "frequency", direction: "descending" };
const verbType = word => verbGroupLabels[word.verbGroup];
const browserColumns = new Map([
  ["mastery", { label: "Mastery" }],
  ["next-review", { label: "Due in" }],
  ...[...vocabularyColumns].filter(([column]) => column !== "frequency"),
  ["subcategory", { label: "Subcategory", value: verbType }],
  ["frequency", vocabularyColumns.get("frequency")],
]);
const practiceOrder = new Map([
  ["mastery", orderVocabularyByMastery],
  ["next-review", orderVocabularyByNextReview],
]);
const formatPercent = new Intl.NumberFormat(undefined, { style: "percent" }).format;
const reviewDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function timeUntilReview(milliseconds) {
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const duration = [];
  if (days) duration.push(`${days}d`);
  if (hours % 24) duration.push(`${hours % 24}h`);
  if (!days && minutes % 60) duration.push(`${minutes % 60}m`);
  return duration;
}

function NextReview({ dueAt, now }) {
  if (dueAt === null) return <small><span aria-hidden="true">—</span><span className="sr-only">No review scheduled</span></small>;
  if (dueAt === 0) return <span className="vocabulary-browser__due">Due now</span>;
  const date = new Date(dueAt);
  const due = dueAt <= now;
  return <time dateTime={date.toISOString()} title={reviewDateTime.format(date)}
    className={due ? "vocabulary-browser__due" : undefined}>
    {due ? "Due now" : timeUntilReview(dueAt - now).map((part, index) => <Fragment key={part}>
      {index > 0 && <wbr />}{part}
    </Fragment>)}
  </time>;
}

function WordMeanings({ meanings }) {
  if (!meanings.length) return null;
  return <details className="vocabulary-browser__meanings">
    <summary aria-label={`${meanings.length} more ${meanings.length === 1 ? "meaning" : "meanings"}`}>
      {meanings.length} more
    </summary>
    <ul>{meanings.map((meaning, index) => <li key={index}>{meaning}</li>)}</ul>
  </details>;
}

const VocabularyRow = memo(function VocabularyRow({ word, meanings, mastery, dueAt, now }) {
  const [shortMeaning, ...otherMeanings] = vocabularyMeanings(meanings ? { meanings } : word);
  return <tr>
    <td className="vocabulary-browser__mastery">
      {mastery === null ? <small title="Not practiced">
        <span aria-hidden="true">—</span><span className="sr-only">Not practiced</span>
      </small> : <span className="vocabulary-browser__mastery-ring"
        style={{ "--mastery": `${mastery}%` }}>
        <small>{formatPercent(mastery / 100)}</small>
      </span>}
    </td>
    <td className="vocabulary-browser__review"><NextReview dueAt={dueAt} now={now} /></td>
    <th scope="row"><span lang="ja">{word.word}</span>
      {word.reading && word.reading !== word.word && <small lang="ja">{word.reading}</small>}
      {word.romaji && <small lang="ja-Latn">{word.romaji}</small>}
    </th>
    <td>
      {shortMeaning || <em>Meaning unavailable</em>}
      <WordMeanings meanings={otherMeanings} />
    </td>
    <td className="vocabulary-browser__category">{vocabularyCategory(word.pos)}</td>
    <td className="vocabulary-browser__subcategory">{verbType(word) ?? "—"}</td>
    <td className="vocabulary-browser__frequency">{word.count.toLocaleString()}</td>
  </tr>;
});

export function VocabularyBrowser({ loadHistoryPage, loadReview, history, columnSort, onColumnSort, onClose }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [result, setResult] = useState(null);
  const [legacy, setLegacy] = useState(null);
  const [search, setSearch] = useState(null);
  const [details, setDetails] = useState(() => new Map());
  const [detailsError, setDetailsError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [limitRequest, setLimitRequest] = useState(null);
  const [asOf] = useState(Date.now);
  const [now, setNow] = useState(asOf);
  const pageKey = JSON.stringify([settledQuery, category, columnSort]);
  const index = result?.retry === retry ? result : null;
  const published = index?.words ?? empty;
  const currentSearch = search?.query === settledQuery && search.index === index ? search : null;
  const searching = Boolean(settledQuery && published.length && !currentSearch);
  const loading = !index || searching;
  const error = index?.error ?? currentSearch?.error;
  const activeSort = columnSort ?? defaultSort;
  const publishedIds = useMemo(() => new Set(published.map(word => word.id)), [published]);
  const remembered = useMemo(() => index?.words
    ? [...history].filter(([id]) => !publishedIds.has(id)).map(([id, record]) =>
      (legacy?.index === index ? legacy.words.get(id) : undefined) ?? rememberedVocabulary(id, record))
    : empty, [index, history, publishedIds, legacy]);
  const words = useMemo(() => sortVocabulary([...published, ...remembered]), [published, remembered]);
  const { scores, dates } = useMemo(() => {
    const scores = new Map();
    const dates = new Map();
    for (const [id, record] of history) {
      if (record.halfLife || record.reviewContext) scores.set(id, Math.round(masteryAt(record, asOf)));
      const dueAt = nextPracticeReviewAt(record);
      if (Number.isFinite(dueAt)) dates.set(id, dueAt);
    }
    return { scores, dates };
  }, [history, asOf]);
  const ordered = useMemo(() => {
    if (loading || error) return empty;
    const candidates = filterVocabulary(words, "", category);
    const rememberedMatches = settledQuery ? new Set(filterVocabulary(remembered, settledQuery).map(word => word.id)) : null;
    const matches = rememberedMatches
      ? candidates.filter(word => currentSearch?.matches?.has(word.id) || rememberedMatches.has(word.id))
      : candidates;
    const orderByPractice = practiceOrder.get(activeSort.column);
    if (orderByPractice) {
      const index = matches.map(word => [word.id, true]);
      const byId = new Map(matches.map(word => [word.id, word]));
      const values = activeSort.column === "mastery" ? scores : dates;
      return orderByPractice(index, values, activeSort.direction).map(id => byId.get(id));
    }
    return activeSort === defaultSort ? matches : sortVocabularyByColumn(matches, activeSort, browserColumns.get(activeSort.column));
  }, [loading, error, words, remembered, settledQuery, currentSearch, category, activeSort, scores, dates]);
  const limit = limitRequest?.pageKey === pageKey ? limitRequest.limit : vocabularyPageSize;
  const visible = useMemo(() => ordered.slice(0, limit), [ordered, limit]);
  const hasMore = ordered.length > limit;
  const missingDetails = useMemo(() => visible.filter(word => publishedIds.has(word.id) && !details.has(word.id))
    .slice(0, vocabularyPageSize).map(word => word.id), [visible, publishedIds, details]);
  const detailError = detailsError?.ids === missingDetails ? detailsError.error : null;
  const loadingDetails = missingDetails.length > 0 && !detailError;

  function sortBy(column) {
    const direction = column === activeSort.column
      ? (activeSort.direction === "ascending" ? "descending" : "ascending")
      : (column === "frequency" || column === "mastery" ? "descending" : "ascending");
    onColumnSort({ column, direction });
  }

  useLayoutEffect(() => {
    dialogRef.current.showModal();
    headingRef.current.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    resultsRef.current.scrollTop = 0;
  }, [pageKey]);
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void loadVocabularyBatches([...history.keys()], "index", "", loadHistoryPage, signal).then(words => {
      if (!signal.aborted) setResult({ retry, words });
    }, failure => {
      if (!signal.aborted) setResult({ retry, error: failure.message });
    });
    return () => controller.abort();
  }, [history, loadHistoryPage, retry]);
  useEffect(() => {
    if (!index?.words) return;
    const missing = [...history].filter(([id, record]) => !publishedIds.has(id) && !record.vocabulary)
      .map(([id]) => id);
    if (!missing.length) return;
    const controller = new AbortController();
    void recoverLegacyVocabulary(missing, loadReview, controller.signal, words => {
      setLegacy(previous => {
        const recovered = new Map(previous?.index === index ? previous.words : []);
        for (const word of words) recovered.set(word.id, word);
        return { index, words: recovered };
      });
      // The stored readings and meanings remain usable if archive recovery fails.
    }).catch(() => {});
    return () => controller.abort();
  }, [index, history, publishedIds, loadReview]);
  useEffect(() => {
    if (!settledQuery || !publishedIds.size) return;
    const controller = new AbortController();
    const { signal } = controller;
    void loadVocabularyBatches([...publishedIds], "matches", settledQuery, loadHistoryPage, signal).then(matches => {
      if (!signal.aborted) setSearch({ query: settledQuery, index, matches: new Set(matches) });
    }, failure => {
      if (!signal.aborted) setSearch({ query: settledQuery, index, error: failure.message });
    });
    return () => controller.abort();
  }, [index, publishedIds, settledQuery, loadHistoryPage]);
  useEffect(() => {
    if (!missingDetails.length || detailError) return;
    const controller = new AbortController();
    const { signal } = controller;
    void loadHistoryPage("details", missingDetails, "", signal).then(({ words }) => {
      if (signal.aborted) return;
      setDetails(previous => {
        const next = new Map(previous);
        for (const id of missingDetails) next.set(id, null);
        for (const word of words) next.set(word.id, word.meanings);
        return next;
      });
    }, failure => {
      if (!signal.aborted) setDetailsError({ ids: missingDetails, error: failure.message });
    });
    return () => controller.abort();
  }, [missingDetails, detailError, loadHistoryPage]);
  useEffect(() => {
    if (!dates.size) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [dates]);
  useEffect(() => {
    if (!hasMore || missingDetails.length) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setLimitRequest({ pageKey, limit: limit + vocabularyPageSize });
      }
    }, { root: resultsRef.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, missingDetails, pageKey, limit]);

  return <dialog ref={dialogRef} className="vocabulary-browser" aria-labelledby="vocabulary-browser-title"
    onClose={onClose}>
    <DialogClose label="Close vocabulary" />
    <h2 ref={headingRef} id="vocabulary-browser-title" className="sr-only" tabIndex={-1}>Vocabulary</h2>
    <div className="vocabulary-browser__content">
      <header className="vocabulary-browser__header">
        <div className="vocabulary-browser__controls">
          <input className="vocabulary-browser__search" type="search"
            aria-label="Find a word by Japanese, reading, or English meaning"
            value={query} maxLength={200} placeholder="Search vocabulary" onChange={event => setQuery(event.target.value)} />
          <label>
            <span className="sr-only">Category</span>
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {vocabularyCategories.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </header>
      <div className="sr-only" role="status">
        {loading ? "Loading words…" : loadingDetails && "Loading word details…"}
      </div>
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        <table aria-label="Words introduced in Practice">
          <thead><tr>
            {[...browserColumns].map(([column, { label }]) => {
              const direction = activeSort.column === column ? activeSort.direction : undefined;
              return <th key={column} scope="col" aria-sort={direction}
                className={`vocabulary-browser__${column}`}>
                <button type="button" className="vocabulary-browser__sort" onClick={() => sortBy(column)}
                  aria-label={column === "frequency" ? "Frequency count" : undefined}
                  title={column === "frequency" ? "Total occurrences in published subtitles" : undefined}>
                  <span>{label}</span>
                  <span aria-hidden="true" className="vocabulary-browser__sort-icon" />
                </button>
              </th>;
            })}
          </tr></thead>
          <tbody>{visible.map(word => {
            const mastery = scores.get(word.id) ?? null;
            const dueAt = dates.get(word.id) ?? null;
            const meanings = details.get(word.id);
            return <VocabularyRow key={word.id} word={word} meanings={meanings} mastery={mastery}
              dueAt={dueAt} now={dueAt ? now : undefined} />;
          })}</tbody>
        </table>
        {(loading || loadingDetails) && <div className="loading-spinner" aria-hidden="true" />}
        {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
        {detailError && <p role="alert">{detailError} <button onClick={() => setDetailsError(null)}>Try again</button></p>}
        {!loading && !error && !visible.length && <p>No words match your search.</p>}
        {hasMore && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
