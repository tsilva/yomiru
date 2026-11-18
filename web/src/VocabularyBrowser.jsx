import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { DownloadIcon } from "./DownloadIcon.jsx";
import {
  corpusSorts, filterVocabulary, sortVocabularyByColumn, vocabularyCategory, vocabularyColumns, vocabularyMeanings,
} from "./vocabulary-study.mjs";
import "./vocabulary-browser.css";

const batchSize = 40;

function WordMeanings({ meanings }) {
  if (!meanings.length) return null;
  return <details className="vocabulary-browser__meanings">
    <summary aria-label={`${meanings.length} more ${meanings.length === 1 ? "meaning" : "meanings"}`}>
      {meanings.length} more
    </summary>
    <ul>{meanings.map((meaning, index) => <li key={index}>{meaning}</li>)}</ul>
  </details>;
}

const VocabularyRow = memo(function VocabularyRow({ word, rank }) {
  const [shortMeaning, ...otherMeanings] = vocabularyMeanings(word);
  return <tr>
    <td>{vocabularyCategory(word.pos)}</td>
    <th scope="row"><span lang="ja">{word.word}</span>
      {word.reading && word.reading !== word.word && <small lang="ja">{word.reading}</small>}
      {word.romaji && <small lang="ja-Latn">{word.romaji}</small>}
    </th>
    <td>
      {shortMeaning || <em>Meaning unavailable</em>}
      <div className="vocabulary-browser__inline-meanings"><WordMeanings meanings={otherMeanings} /></div>
    </td>
    <td className="vocabulary-browser__other-meanings"><WordMeanings meanings={otherMeanings} /></td>
    <td className="vocabulary-browser__rank">
      {rank == null ? <em>Unranked</em> : rank.toLocaleString()}
    </td>
    <td aria-label={`${word.count.toLocaleString()} occurrences in selected episodes`}>{word.count.toLocaleString()}</td>
  </tr>;
});

export function VocabularyBrowser({ words, total, episodeCount, order, onOrderChange, columnSort, onColumnSort,
  onDownload, onClose, loading, error, onRetry, downloading, downloadError }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const moreRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loaded, setLoaded] = useState(null);
  const corpus = corpusSorts.get(order);
  const selectionRanks = useMemo(() => order === "frequency"
    ? new Map(words.map((word, index) => [word.id, index + 1]))
    : null, [words, order]);
  const categories = useMemo(() => [...new Set(words.map(word => vocabularyCategory(word.pos)))].sort(), [words]);
  const sorted = useMemo(() => columnSort ? sortVocabularyByColumn(words, order, columnSort) : words,
    [words, order, columnSort]);
  const matching = useMemo(() => filterVocabulary(sorted, query, category), [sorted, query, category]);
  const limit = loaded?.matching === matching ? loaded.limit : batchSize;
  const visible = matching.slice(0, limit);
  const hasMore = !loading && !error && limit < matching.length;
  const activeSort = columnSort ?? { column: "rank", direction: "ascending" };

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
  }, [matching]);
  useEffect(() => {
    if (!hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setLoaded({ matching, limit: limit + batchSize });
      }
    }, { root: resultsRef.current, rootMargin: "0px 0px 240px 0px" });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, matching, limit]);

  return <dialog ref={dialogRef} className="vocabulary-browser" aria-labelledby="vocabulary-browser-title"
    onClose={onClose}>
    <DialogClose label="Close vocabulary" />
    <div className="vocabulary-browser__content">
      <header className="vocabulary-browser__header">
        <div>
          <h2 id="vocabulary-browser-title">Episode vocabulary</h2>
          <p>{total.toLocaleString()} {total === 1 ? "word" : "words"} across {episodeCount} {episodeCount === 1 ? "episode" : "episodes"}</p>
        </div>
        <button type="button" className="vocabulary-browser__download" aria-label="Download full CSV"
          title={downloading ? "Preparing CSV…" : "Download full CSV"} aria-busy={downloading || undefined}
          disabled={downloading} onClick={onDownload}>
          <DownloadIcon />
        </button>
      </header>
      {downloadError && <p className="vocabulary-browser__download-error" role="alert">{downloadError}</p>}
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
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Frequency type</span>
          <select value={order} onChange={event => onOrderChange(event.target.value)}>
            <option value="frequency">Selection frequency</option>
            {[...corpusSorts].map(([value, sort]) => <option key={value} value={value}>{sort.label}</option>)}
          </select>
        </label>
        {corpus && <p className="vocabulary-browser__rank-source">
          Ranks from <a href={corpus.url} target="_blank" rel="noreferrer">{corpus.source}</a>.
        </p>}
      </div>
      <div ref={resultsRef} className="vocabulary-browser__results" role="region" aria-label="Vocabulary results"
        aria-busy={loading} tabIndex={0}>
        {loading ? <p>Loading words…</p> : error ? <p role="alert">{error} <button onClick={onRetry}>Try again</button></p>
        : visible.length ? <table aria-label="Words in selected episodes">
          <thead><tr>
            {[...vocabularyColumns].map(([column, { label }]) => {
              const direction = activeSort.column === column ? activeSort.direction : undefined;
              const className = column === "otherMeanings" ? "vocabulary-browser__other-meanings"
                : column === "rank" ? "vocabulary-browser__rank" : undefined;
              return <th key={column} scope="col" className={className} aria-sort={direction}>
                <button type="button" className="vocabulary-browser__sort" onClick={() => sortBy(column)}
                  title={column === "frequency" ? "Occurrences in selected episodes" : undefined}>
                  <span>{label}</span>
                  <span aria-hidden="true" className="vocabulary-browser__sort-icon" />
                </button>
              </th>;
            })}
          </tr></thead>
          <tbody>{visible.map(word => <VocabularyRow key={word.id} word={word}
            rank={corpus ? word[corpus.rankField] : selectionRanks?.get(word.id)} />)}</tbody>
        </table> : <p>No words match your search.</p>}
        {hasMore && <div ref={moreRef} className="vocabulary-browser__more" aria-hidden="true" />}
      </div>
    </div>
  </dialog>;
}
