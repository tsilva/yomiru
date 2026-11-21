import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { isPracticePartOfSpeech, masteryAt, nextPracticeReviewAt } from "./vocabulary-practice.mjs";
import { readPracticeProgress } from "./vocabulary-practice-storage.mjs";
import { orderVocabularyByMastery, orderVocabularyByNextReview } from "./vocabulary-mastery.mjs";
import {
  vocabularyCategories, vocabularyCategory, vocabularyColumns, vocabularyMeanings, vocabularyPageSize,
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
const reviewDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const reviewTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const reviewDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function NextReview({ dueAt, now }) {
  if (dueAt === null) return <small><span aria-hidden="true">—</span><span className="sr-only">No review scheduled</span></small>;
  if (dueAt === 0) return <span className="vocabulary-browser__due">Due now</span>;
  const date = new Date(dueAt);
  const due = dueAt <= now;
  const today = date.toDateString() === new Date(now).toDateString();
  const label = due ? "Due now" : (today ? reviewTime : reviewDate).format(date);
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
      {mastery === null ? <small>{masteryStatus}</small> : <>
        <span className="vocabulary-browser__mastery-bar" aria-hidden="true"
          style={{ "--mastery": `${mastery}%` }} />
        <small>{formatPercent(mastery / 100)}</small>
      </>}
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

export function VocabularyBrowser({ loadPage, columnSort, onColumnSort, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
  const practiceIndex = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [page, setPage] = useState(null);
  const [offsetRequest, setOffsetRequest] = useState(null);
  const [retry, setRetry] = useState(0);
  const [practice, setPractice] = useState(null);
  const pageKey = JSON.stringify([settledQuery, category, columnSort]);
  const current = page?.key === pageKey && page.loadPage === loadPage ? page : null;
  const offset = current && offsetRequest?.key === pageKey && offsetRequest.loadPage === loadPage ? offsetRequest.offset : 0;
  const visible = current?.words ?? empty;
  const loading = !current || current.offset !== offset;
  const error = current?.error;
  const hasMore = !loading && !error && current.nextOffset !== null;
  const activeSort = columnSort ?? defaultSort;
  const orderByPractice = practiceOrder.get(activeSort.column);
  const practiceValues = activeSort.column === "mastery" ? practice?.scores : practice?.dates;
  const sortValues = orderByPractice ? practiceValues : null;
  const masteryStatus = practice?.scores ? "Not practiced" : practice ? "Unavailable" : "…";

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
  }, [pageKey, loadPage]);
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (orderByPractice && sortValues === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    function settle(result) {
      if (signal.aborted) return;
      setPage(previous => {
        const earlier = offset && previous?.key === pageKey && previous.loadPage === loadPage
          ? previous.words.slice(0, offset) : empty;
        return { loadPage, key: pageKey, offset, ...result, words: [...earlier, ...(result.words ?? empty)] };
      });
    }
    const options = { query: settledQuery, category, offset };
    async function load() {
      if (!orderByPractice) return loadPage(options, columnSort, signal);
      if (!sortValues?.size) return loadPage(options, null, signal);
      const key = JSON.stringify([settledQuery, category]);
      let cached = practiceIndex.current;
      if (cached?.key !== key || cached.loadPage !== loadPage) {
        const index = [];
        let indexOffset = 0;
        do {
          const batch = await loadPage({ ...options, offset: indexOffset, index: true }, null, signal);
          signal.throwIfAborted();
          if (!Array.isArray(batch.index) || (batch.nextOffset !== null
            && (!Number.isInteger(batch.nextOffset) || batch.nextOffset <= indexOffset))) {
            throw new Error("Sorting by practice progress is temporarily unavailable.");
          }
          index.push(...batch.index);
          indexOffset = batch.nextOffset;
        } while (indexOffset !== null);
        cached = { key, loadPage, index, orders: new Map() };
        practiceIndex.current = cached;
      }
      if (!cached.orders.has(pageKey)) {
        cached.orders.set(pageKey, orderByPractice(cached.index, sortValues, columnSort.direction));
      }
      const ordered = cached.orders.get(pageKey);
      const end = offset + vocabularyPageSize;
      const ids = ordered.slice(offset, end);
      if (!ids.length) return { words: empty, nextOffset: null };
      const { words } = await loadPage({ query: "", category: "", offset: 0, wordIds: [...ids].sort() }, null, signal);
      const byId = new Map(words.map(word => [word.id, word]));
      if (ids.some(id => !byId.has(id))) throw new Error("Some words could not be loaded. Try again.");
      return { words: ids.map(id => byId.get(id)), nextOffset: end < ordered.length ? end : null };
    }
    void load().then(settle,
      failure => settle({ error: failure.message, nextOffset: null }));
    return () => controller.abort();
  }, [loadPage, pageKey, offset, settledQuery, category, columnSort, retry, orderByPractice, sortValues]);
  useEffect(() => {
    let active = true;
    void readPracticeProgress().then(progress => {
      if (!active) return;
      const now = Date.now();
      const scores = new Map();
      const dates = new Map();
      for (const [id, record] of progress) {
        scores.set(id, Math.round(masteryAt(record, now)));
        const dueAt = nextPracticeReviewAt(record);
        if (Number.isFinite(dueAt)) dates.set(id, dueAt);
      }
      setPractice({ scores, dates, now });
    }, () => {
      if (active) setPractice({ scores: null, dates: null });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setOffsetRequest({ key: pageKey, loadPage, offset: current.nextOffset });
      }
    }, { root: resultsRef.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, current, pageKey, loadPage]);

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
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        <table aria-label="Words in starred episodes and movies">
          <thead><tr>
            {browserColumns.map(([column, { label }]) => {
              const direction = activeSort.column === column ? activeSort.direction : undefined;
              const frequencyColumn = column === "frequency";
              return <th key={column} scope="col" aria-sort={direction}
                className={`vocabulary-browser__${column}`}>
                <button type="button" className="vocabulary-browser__sort" onClick={() => sortBy(column)}
                  aria-label={frequencyColumn ? "Frequency count" : undefined}
                  title={frequencyColumn ? "Total occurrences in starred episodes and movies" : undefined}>
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
            const mastery = eligible ? practice?.scores?.get(word.id) ?? null : null;
            return <VocabularyRow key={word.id} word={word} mastery={mastery}
              dueAt={eligible ? practice?.dates?.get(word.id) ?? null : null} now={practice?.now}
              masteryStatus={eligible ? masteryStatus : "Not in practice"} />;
          })}</tbody>
        </table>
        {loading && <p>{visible.length ? "Loading more words…" : "Loading words…"}</p>}
        {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
        {!loading && !error && !visible.length && <p>No words match your search.</p>}
        {hasMore && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
