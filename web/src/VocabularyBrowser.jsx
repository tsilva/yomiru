import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { isPracticePartOfSpeech, masteryAt, nextPracticeReviewAt } from "./vocabulary-practice.mjs";
import { orderVocabularyByMastery, orderVocabularyByNextReview } from "./vocabulary-mastery.mjs";
import {
  filterVocabulary, sortVocabularyByColumn, vocabularyCategories, vocabularyCategory, vocabularyColumns, vocabularyMeanings, vocabularyPageSize,
} from "./vocabulary-study.mjs";
import "./vocabulary-browser.css";

const empty = [];
const defaultSort = { column: "frequency", direction: "descending" };
const browserColumns = [
  ["mastery", { label: "Mastery" }],
  ["next-review", { label: "Next review" }],
  ...vocabularyColumns,
];
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
  return `in ${duration.join("")}`;
}

function NextReview({ dueAt, now }) {
  if (dueAt === null) return <small><span aria-hidden="true">—</span><span className="sr-only">No review scheduled</span></small>;
  if (dueAt === 0) return <span className="vocabulary-browser__due">Due now</span>;
  const date = new Date(dueAt);
  const due = dueAt <= now;
  const label = due ? "Due now" : timeUntilReview(dueAt - now);
  return <time dateTime={date.toISOString()} title={reviewDateTime.format(date)}
    className={due ? "vocabulary-browser__due" : undefined}>{label}</time>;
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

const VocabularyRow = memo(function VocabularyRow({ word, mastery, masteryStatus, dueAt, now }) {
  const [shortMeaning, ...otherMeanings] = vocabularyMeanings(word);
  return <tr>
    <td className="vocabulary-browser__mastery">
      {mastery === null ? <small title={masteryStatus}>
        <span aria-hidden="true">—</span><span className="sr-only">{masteryStatus}</span>
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
    <td>{word.count.toLocaleString()}</td>
  </tr>;
});

export function VocabularyBrowser({ loadHistory, history, columnSort, onColumnSort, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [result, setResult] = useState(null);
  const [retry, setRetry] = useState(0);
  const [limitRequest, setLimitRequest] = useState(null);
  const [asOf] = useState(Date.now);
  const [now, setNow] = useState(asOf);
  const pageKey = JSON.stringify([settledQuery, category, columnSort]);
  const current = result?.loadHistory === loadHistory && result.retry === retry ? result : null;
  const loading = !current;
  const error = current?.error;
  const words = current?.words ?? empty;
  const activeSort = columnSort ?? defaultSort;
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
    const matches = filterVocabulary(words, settledQuery, category);
    const orderByPractice = practiceOrder.get(activeSort.column);
    if (orderByPractice) {
      const index = matches.map(word => [word.id, isPracticePartOfSpeech(word.pos)]);
      const byId = new Map(matches.map(word => [word.id, word]));
      const values = activeSort.column === "mastery" ? scores : dates;
      return orderByPractice(index, values, activeSort.direction).map(id => byId.get(id));
    }
    return activeSort === defaultSort ? matches : sortVocabularyByColumn(matches, activeSort);
  }, [words, settledQuery, category, activeSort, scores, dates]);
  const limit = limitRequest?.ordered === ordered ? limitRequest.limit : vocabularyPageSize;
  const visible = ordered.slice(0, limit);
  const hasMore = ordered.length > limit;

  function sortBy(column) {
    const direction = column === activeSort.column
      ? (activeSort.direction === "ascending" ? "descending" : "ascending")
      : (column === "frequency" || column === "mastery" ? "descending" : "ascending");
    onColumnSort({ column, direction });
  }

  useLayoutEffect(() => {
    dialogRef.current.showModal();
    searchRef.current.focus();
  }, []);
  useLayoutEffect(() => {
    resultsRef.current.scrollTop = 0;
  }, [pageKey, loadHistory]);
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void loadHistory(signal).then(words => {
      if (!signal.aborted) setResult({ loadHistory, retry, words });
    }, failure => {
      if (!signal.aborted) setResult({ loadHistory, retry, error: failure.message });
    });
    return () => controller.abort();
  }, [loadHistory, retry]);
  useEffect(() => {
    if (!dates.size) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [dates]);
  useEffect(() => {
    if (!hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setLimitRequest({ ordered, limit: limit + vocabularyPageSize });
      }
    }, { root: resultsRef.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, ordered, limit]);

  return <dialog ref={dialogRef} className="vocabulary-browser" aria-labelledby="vocabulary-browser-title"
    onClose={onClose}>
    <DialogClose label="Close vocabulary" />
    <div className="vocabulary-browser__content">
      <header className="vocabulary-browser__header">
        <h2 id="vocabulary-browser-title">Vocabulary</h2>
        <div className="vocabulary-browser__controls">
          <input className="vocabulary-browser__search" ref={searchRef} type="search"
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
        {loading && "Loading words…"}
      </div>
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        <table aria-label="Words introduced in Practice">
          <thead><tr>
            {browserColumns.map(([column, { label }]) => {
              const direction = activeSort.column === column ? activeSort.direction : undefined;
              const frequencyColumn = column === "frequency";
              return <th key={column} scope="col" aria-sort={direction}
                className={`vocabulary-browser__${column}`}>
                <button type="button" className="vocabulary-browser__sort" onClick={() => sortBy(column)}
                  aria-label={frequencyColumn ? "Frequency count" : undefined}
                  title={frequencyColumn ? "Total occurrences in published subtitles" : undefined}>
                  {frequencyColumn ? <>
                    <span className="vocabulary-browser__frequency-label">{label}</span>
                    <span className="vocabulary-browser__count-label">Count</span>
                  </> : <span>{label}</span>}
                  <span aria-hidden="true" className="vocabulary-browser__sort-icon" />
                </button>
              </th>;
            })}
          </tr></thead>
          <tbody>{visible.map(word => {
            const eligible = isPracticePartOfSpeech(word.pos);
            const mastery = eligible ? scores.get(word.id) ?? null : null;
            const dueAt = eligible ? dates.get(word.id) ?? null : null;
            return <VocabularyRow key={word.id} word={word} mastery={mastery} dueAt={dueAt} now={dueAt ? now : undefined}
              masteryStatus={eligible ? "Not practiced" : "Not in practice"} />;
          })}</tbody>
        </table>
        {loading && <div className="loading-spinner" aria-hidden="true" />}
        {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
        {!loading && !error && !visible.length && <p>No words match your search.</p>}
        {hasMore && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
