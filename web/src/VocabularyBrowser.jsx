import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { filterVocabulary, vocabularyCategory } from "./vocabulary-study.mjs";
import "./vocabulary-browser.css";

const PAGE_SIZE = 40;

function WordMeanings({ meanings }) {
  if (!meanings.length) return null;
  return <details className="vocabulary-browser__meanings">
    <summary>{meanings.length} more {meanings.length === 1 ? "meaning" : "meanings"}</summary>
    <p>{meanings.join("; ")}</p>
  </details>;
}

function VocabularyRow({ word }) {
  const [shortMeaning, ...otherMeanings] = [...word.meanings].filter(meaning => meaning.trim());
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
    <td aria-label={`${word.count.toLocaleString()} occurrences in selected episodes`}>{word.count.toLocaleString()}</td>
  </tr>;
}

export function VocabularyBrowser({ words, episodeCount, order, onOrderChange, meaningsControl, onDownload, onClose }) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const categories = useMemo(() => [...new Set(words.map(word => vocabularyCategory(word.pos)))].sort(), [words]);
  const matching = useMemo(() => filterVocabulary(words, query, category), [words, query, category]);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = matching.slice(start, start + PAGE_SIZE);

  useLayoutEffect(() => {
    dialogRef.current.showModal();
    searchRef.current.focus();
  }, []);

  return <dialog ref={dialogRef} className="vocabulary-browser" aria-labelledby="vocabulary-browser-title"
    onClose={onClose}>
    <DialogClose label="Close vocabulary" />
    <div className="vocabulary-browser__content">
      <header className="vocabulary-browser__header">
        <h2 id="vocabulary-browser-title">Episode vocabulary</h2>
        <p>{words.length.toLocaleString()} {words.length === 1 ? "word" : "words"} across {episodeCount} {episodeCount === 1 ? "episode" : "episodes"}</p>
      </header>
      <div className="vocabulary-browser__controls" onChange={() => setPage(1)}>
        <label className="vocabulary-browser__search">
          <span>Find a word</span>
          <input ref={searchRef} type="search" value={query} maxLength={200} placeholder="Japanese, reading, or meaning"
            onChange={event => setQuery(event.target.value)} />
        </label>
        <label>
          <span>Category</span>
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        {meaningsControl}
        <label>
          <span>Sort by</span>
          <select value={order} onChange={event => onOrderChange(event.target.value)}>
            <option value="frequency">Most frequent</option>
            <option value="reading">Japanese reading</option>
          </select>
        </label>
      </div>
      <div className="vocabulary-browser__results" role="region" aria-label="Vocabulary results" tabIndex={0}
        key={currentPage}>
        {visible.length ? <table aria-label="Words in selected episodes">
          <thead><tr>
            <th scope="col">Category</th>
            <th scope="col" aria-sort={order === "reading" ? "ascending" : undefined}>Japanese</th>
            <th scope="col">Short meaning</th>
            <th scope="col" className="vocabulary-browser__other-meanings">Other meanings</th>
            <th scope="col" aria-sort={order === "frequency" ? "descending" : undefined}>
              <abbr title="Occurrences in selected episodes">Uses</abbr>
            </th>
          </tr></thead>
          <tbody>{visible.map(word => <VocabularyRow key={word.id} word={word} />)}</tbody>
        </table> : <p>No words match your search.</p>}
      </div>
      <footer className="vocabulary-browser__footer">
        <div className="vocabulary-browser__pagination">
          {pages > 1 && <button type="button" className="vocabulary-browser__page-arrow"
            aria-label="Previous page" title="Previous page"
            onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} />}
          <span role="status">{visible.length ? `${(start + 1).toLocaleString()}–${(start + visible.length).toLocaleString()} of ${matching.length.toLocaleString()}` : "0 matches"}</span>
          {pages > 1 && <button type="button" className="vocabulary-browser__page-arrow"
            aria-label="Next page" title="Next page"
            onClick={() => setPage(currentPage + 1)} disabled={currentPage === pages} />}
        </div>
        <button type="button" className="vocabulary-browser__download" onClick={onDownload}>Download full CSV</button>
      </footer>
    </div>
  </dialog>;
}
