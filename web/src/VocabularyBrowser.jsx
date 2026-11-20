import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { masteryAt } from "./vocabulary-practice.mjs";
import { readPracticeProgress } from "./vocabulary-practice-storage.mjs";
import {
  vocabularyCategories, vocabularyCategory, vocabularyColumns, vocabularyMeanings,
} from "./vocabulary-study.mjs";
import "./vocabulary-browser.css";

const empty = [];
const defaultSort = { column: "frequency", direction: "descending" };
const formatPercent = new Intl.NumberFormat(undefined, { style: "percent" }).format;

function WordMeanings({ meanings }) {
  if (!meanings.length) return null;
  return <details className="vocabulary-browser__meanings">
    <summary aria-label={`${meanings.length} more ${meanings.length === 1 ? "meaning" : "meanings"}`}>
      {meanings.length} more
    </summary>
    <ul>{meanings.map((meaning, index) => <li key={index}>{meaning}</li>)}</ul>
  </details>;
}

const VocabularyRow = memo(function VocabularyRow({ word, mastery, masteryStatus }) {
  const [shortMeaning, ...otherMeanings] = vocabularyMeanings(word);
  return <tr>
    <td className="vocabulary-browser__mastery">
      {mastery === null ? <small>{masteryStatus}</small> : <>
        <span className="vocabulary-browser__mastery-bar" aria-hidden="true"
          style={{ "--mastery": `${mastery}%` }} />
        <small>{formatPercent(mastery / 100)}</small>
      </>}
    </td>
    <th scope="row"><span lang="ja">{word.word}</span>
      {word.reading && word.reading !== word.word && <small lang="ja">{word.reading}</small>}
      {word.romaji && <small lang="ja-Latn">{word.romaji}</small>}
    </th>
    <td>
      {shortMeaning || <em>Meaning unavailable</em>}
      <WordMeanings meanings={otherMeanings} />
    </td>
    <td>{vocabularyCategory(word.pos)}</td>
    <td aria-label={`${word.count.toLocaleString()} occurrences in the selection`}>{word.count.toLocaleString()}</td>
  </tr>;
});

export function VocabularyBrowser({ loadPage, total, countLabel, columnSort, onColumnSort, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
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
  const masteryStatus = practice?.progress ? "Not practiced" : practice ? "Unavailable" : "…";

  function sortBy(column) {
    const direction = column === activeSort.column
      ? (activeSort.direction === "ascending" ? "descending" : "ascending")
      : (column === "frequency" ? "descending" : "ascending");
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
    void loadPage({ query: settledQuery, category, offset }, columnSort, signal).then(settle,
      failure => settle({ error: failure.message, nextOffset: null }));
    return () => controller.abort();
  }, [loadPage, pageKey, offset, settledQuery, category, columnSort, retry]);
  useEffect(() => {
    let active = true;
    void readPracticeProgress().then(progress => {
      if (active) setPractice({ progress, asOf: Date.now() });
    }, () => {
      if (active) setPractice({ progress: null });
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
        <p>{total.toLocaleString()} {total === 1 ? "word" : "words"} across {countLabel}</p>
      </header>
      <div className="vocabulary-browser__controls">
        <label className="vocabulary-browser__search">
          <span>Find a word</span>
          <input ref={searchRef} type="search" value={query} maxLength={200} placeholder="Japanese, reading, or English meaning"
            onChange={event => setQuery(event.target.value)} />
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {vocabularyCategories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        {loading && !visible.length ? <p>Loading words…</p> : error && !visible.length
          ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>
        : visible.length ? <table aria-label="Words in selected episodes">
          <thead><tr>
            <th scope="col" className="vocabulary-browser__mastery">Mastery</th>
            {[...vocabularyColumns].map(([column, { label }]) => {
              const direction = activeSort.column === column ? activeSort.direction : undefined;
              return <th key={column} scope="col" aria-sort={direction}>
                <button type="button" className="vocabulary-browser__sort" onClick={() => sortBy(column)}
                  title={column === "frequency" ? "Occurrences in selected episodes" : undefined}>
                  <span>{label}</span>
                  <span aria-hidden="true" className="vocabulary-browser__sort-icon" />
                </button>
              </th>;
            })}
          </tr></thead>
          <tbody>{visible.map(word => {
            const record = practice?.progress?.get(word.id);
            const mastery = record ? Math.round(masteryAt(record, practice.asOf)) : null;
            return <VocabularyRow key={word.id} word={word} mastery={mastery} masteryStatus={masteryStatus} />;
          })}</tbody>
        </table> : <p>No words match your search.</p>}
        {visible.length > 0 && loading && <p>Loading more words…</p>}
        {visible.length > 0 && error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
        {hasMore && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
