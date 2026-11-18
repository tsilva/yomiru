import { useEffect, useRef, useState } from "react";
import { episodeCode, groupEpisodes } from "./library-episodes.mjs";
import { EpisodeSelection, ShowSelection, VocabularySelection } from "./VocabularySelection.jsx";
import "./subtitle-library.css";

function ShowEpisodes({ group, publication }) {
  const [open, setOpen] = useState(true);
  return <details className="subtitle-library__show" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{group.name}</span></summary>
    <table className="subtitle-library__table" role="table" aria-label={`${group.name} subtitles`}>
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col"><ShowSelection group={group} publication={publication} /></th>
        <th role="columnheader" scope="col">Episode</th><th role="columnheader" scope="col">Title</th>
        <th role="columnheader" scope="col">Translations</th>
        <th role="columnheader" scope="col"><span className="sr-only">Open episode</span></th>
      </tr></thead>
      <tbody role="rowgroup">{group.rows.map(row => <tr role="row" key={row.id}>
        <td role="cell"><label className="subtitle-library__episode-select"><EpisodeSelection row={row} id={`vocabulary-${row.id}`} /></label></td>
        <th role="rowheader" scope="row"><label className="subtitle-library__episode-label" htmlFor={`vocabulary-${row.id}`}>{episodeCode(row.season, row.episode)}</label></th>
        <td role="cell">{row.title}</td>
        <td role="cell">{row.translations.map(language => language.label).join(" · ")}</td>
        <td role="cell">
          <a className="install subtitle-library__play" href={row.stremioUrl} title="Open in Stremio"
            aria-label={`Open ${row.show}, season ${row.season}, episode ${row.episode} in Stremio`}>
            <span className="install__face" aria-hidden="true" />
          </a>
        </td>
      </tr>)}</tbody>
    </table>
  </details>;
}

function LibraryRows({ search }) {
  const [rows, setRows] = useState([]);
  const [publication, setPublication] = useState("");
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const bottom = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setError("");
    const query = new URLSearchParams({ search });
    if (cursor) query.set("cursor", cursor);
    fetch(`/api/browse?${query}`, { signal: controller.signal }).then(async response => {
      if (response.status === 409 && cursor) {
        if (active) { setRows([]); setNextCursor(null); setCursor(""); }
        return;
      }
      if (!response.ok) throw new Error("The subtitle library is temporarily unavailable.");
      const page = await response.json();
      if (!Array.isArray(page.rows) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
        throw new Error("The subtitle library is temporarily unavailable.");
      }
      if (!active) return;
      setPublication(response.headers.get("X-Yomiru-Publication") || "");
      setRows(previous => cursor ? [...previous, ...page.rows] : page.rows);
      setNextCursor(page.nextCursor);
    }).catch(error => {
      if (active && error.name !== "AbortError") setError(error.message);
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); };
  }, [search, cursor, retry]);

  useEffect(() => {
    if (pending || error || !nextCursor || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setCursor(nextCursor);
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [pending, error, nextCursor]);

  return <>
    <div className="subtitle-library__groups" aria-busy={pending}>
      {groupEpisodes(rows).map(group => <ShowEpisodes key={group.id} group={group} publication={publication} />)}
    </div>
    <div className="subtitle-library__status" ref={bottom} aria-live="polite">
      {pending ? <p>Loading subtitles…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></p>
        : !rows.length ? <p>{search ? "No subtitles match your search." : "No episodes have been published yet."}</p>
          : nextCursor ? <button onClick={() => setCursor(nextCursor)}>Load more episodes</button> : null}
    </div>
  </>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  return <section id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <h2 id="library-title">Subtitle library</h2>
    <label className="sr-only" htmlFor="library-search">Search shows, episode titles or episode codes</label>
    <input id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows, titles, or S01E02" autoComplete="off"
      onChange={event => setValue(event.target.value)} />
    <VocabularySelection><LibraryRows key={search} search={search} /></VocabularySelection>
  </section>;
}
