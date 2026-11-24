import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { verbGroupLabels } from "./conjugation-guides.mjs";
import { masteryAt, nextPracticeReviewAt } from "./vocabulary-practice.mjs";
import { orderVocabularyByMastery, orderVocabularyByNextReview } from "./vocabulary-mastery.mjs";
import {
  filterVocabulary, sortVocabulary, sortVocabularyByColumn, vocabularyCategories, vocabularyCategory, vocabularyColumns,
  vocabularyMeanings,
} from "./vocabulary-study.mjs";
import { loadDictionaryEntries } from "./word-drill.mjs";
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

const VocabularyRow = memo(function VocabularyRow({ word, starred, onToggleStar, mastery, dueAt, now }) {
  const [shortMeaning, ...otherMeanings] = vocabularyMeanings(word);
  return <tr>
    <td className="vocabulary-browser__star-cell">
      <button type="button" className="vocabulary-browser__star" aria-label={`Star ${word.word}`}
        aria-pressed={starred} onClick={() => onToggleStar(word)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m12 2.8 2.8 5.7 6.3.9-4.5 4.4 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.5-4.4 6.3-.9Z" />
        </svg>
      </button>
    </td>
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

export function VocabularyBrowser({ loadDictionary, history, stars, onToggleStar, starError, columnSort, onColumnSort, onClose }) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [settledQuery, setSettledQuery] = useState("");
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(null);
  const [retry, setRetry] = useState(0);
  const [asOf] = useState(Date.now);
  const [now, setNow] = useState(asOf);
  const activeSort = columnSort ?? defaultSort;
  const pageKey = JSON.stringify([settledQuery, category, activeSort, starredOnly, retry]);
  const current = result?.key === pageKey ? result : null;
  const offset = page?.key === pageKey ? page.offset : 0;
  const error = current?.error;
  const loading = current?.offset !== offset;
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
  const priority = useMemo(() => {
    const order = practiceOrder.get(activeSort.column);
    const values = activeSort.column === "mastery" ? scores : dates;
    return order ? order([...values.keys()].map(id => [id, true]), values, activeSort.direction) : empty;
  }, [activeSort, scores, dates]);
  const requestedStars = starredOnly ? stars : null;

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
    const timer = setTimeout(() => setSettledQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      const personalSort = practiceOrder.has(activeSort.column);
      if (requestedStars || (personalSort && !offset)) {
        const preferredIds = requestedStars ? requestedStars.values() : priority;
        const entries = await loadDictionaryEntries(preferredIds, loadDictionary, signal);
        const words = filterVocabulary(sortVocabulary(entries), settledQuery, category);
        if (!personalSort) return {
          words: sortVocabularyByColumn(words, activeSort, browserColumns.get(activeSort.column)), nextOffset: null,
        };
        const byId = new Map(words.map(word => [word.id, word]));
        const first = priority.filter(id => byId.has(id)).map(id => byId.get(id));
        if (requestedStars) {
          const seen = new Set(first.map(word => word.id));
          return { words: [...first, ...words.filter(word => !seen.has(word.id))], nextOffset: null };
        }
        const rest = await loadDictionary({ query: settledQuery, category }, signal);
        return { words: [...first, ...rest.words], nextOffset: rest.nextOffset };
      }
      return loadDictionary({ query: settledQuery, category, offset,
        ...(personalSort ? {} : { sort: activeSort.column, direction: activeSort.direction }) }, signal);
    }
    void load().then(({ words, nextOffset }) => {
      if (!signal.aborted) setResult(previous => {
        const combined = offset && previous?.key === pageKey ? [...previous.words, ...words] : words;
        const seen = new Set();
        return { key: pageKey, offset, nextOffset, words: combined.filter(word => {
          if (seen.has(word.root)) return false;
          seen.add(word.root);
          return true;
        }) };
      });
    }, failure => {
      if (!signal.aborted) setResult(previous => ({ key: pageKey, offset, error: failure.message,
        words: previous?.key === pageKey ? previous.words : empty }));
    });
    return () => controller.abort();
  }, [loadDictionary, pageKey, settledQuery, category, offset, activeSort, priority, requestedStars]);
  useEffect(() => {
    if (!dates.size) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [dates]);
  useEffect(() => {
    if (loading || !Number.isInteger(current?.nextOffset)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setPage({ key: pageKey, offset: current.nextOffset });
    }, { root: resultsRef.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [loading, current, pageKey]);

  return <dialog ref={dialogRef} className="vocabulary-browser" aria-labelledby="vocabulary-browser-title"
    onClose={onClose}>
    <DialogClose label="Close vocabulary" />
    <div className="vocabulary-browser__content">
      <header className="vocabulary-browser__header">
        <h2 ref={headingRef} id="vocabulary-browser-title" className="vocabulary-browser__title" tabIndex={-1}>Vocabulary</h2>
        <div className="vocabulary-browser__controls">
          <input className="vocabulary-browser__search" type="search"
            aria-label="Find a word by Japanese, reading, or English meaning"
            value={query} maxLength={100} placeholder="Search vocabulary" onChange={event => setQuery(event.target.value)} />
          <label>
            <span className="sr-only">Category</span>
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {vocabularyCategories.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="vocabulary-browser__views" role="group" aria-label="Dictionary view">
          <button type="button" aria-pressed={!starredOnly} onClick={() => setStarredOnly(false)}>All words</button>
          <button type="button" aria-pressed={starredOnly} onClick={() => setStarredOnly(true)}>Starred</button>
        </div>
        {starError && <p role="alert">Stars couldn’t be saved in this browser.</p>}
      </header>
      <div className="sr-only" role="status">{loading && "Loading words…"}</div>
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        <table aria-label="Japanese dictionary">
          <thead><tr>
            <th scope="col" className="vocabulary-browser__star-cell"><span className="sr-only">Star</span></th>
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
          <tbody>{current?.words.map(word => {
            const dueAt = dates.get(word.id) ?? null;
            return <VocabularyRow key={word.root} word={word} starred={stars.has(word.root)} onToggleStar={onToggleStar}
              mastery={scores.get(word.id) ?? null} dueAt={dueAt} now={dueAt ? now : undefined} />;
          })}</tbody>
        </table>
        {loading && <div className="loading-spinner" aria-hidden="true" />}
        {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
        {!loading && !error && !current?.words.length && <p>
          {starredOnly && !stars.size ? "No starred words yet." : "No words match your search."}
        </p>}
        {Number.isInteger(current?.nextOffset) && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
