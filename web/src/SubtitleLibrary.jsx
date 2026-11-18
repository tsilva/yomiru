import { useCallback, useEffect, useRef, useState } from "react";
import { episodeCode, groupEpisodes } from "./library-episodes.mjs";
import { TitleSelection, ShowSelection, VocabularySelection } from "./VocabularySelection.jsx";
import "./subtitle-library.css";

function OpenInStremio({ row }) {
  const title = row.type === "movie" ? row.title : `${row.show}, season ${row.season}, episode ${row.episode}`;
  return <a className="install subtitle-library__play" href={row.stremioUrl} title="Open in Stremio"
    aria-label={`Open ${title} in Stremio`}>
    <span className="install__face" aria-hidden="true" />
  </a>;
}

function LibraryGroup({ group, publication, onPublicationChange }) {
  const [open, setOpen] = useState(true);
  const selectAll = <ShowSelection key={publication} group={group} publication={publication}
    onPublicationChange={onPublicationChange} />;
  return <details className="subtitle-library__show" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{group.name}</span></summary>
    {group.movie ? <table className="subtitle-library__table subtitle-library__movies" role="table" aria-label={`${group.name} subtitles`}>
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col">{selectAll}</th>
        <th role="columnheader" scope="col">Title</th>
        <th role="columnheader" scope="col">Translations</th>
        <th role="columnheader" scope="col"><span className="sr-only">Open movie</span></th>
      </tr></thead>
      <tbody role="rowgroup">{group.rows.map(row => <tr role="row" key={row.id}>
        <td role="cell"><label className="subtitle-library__episode-select"><TitleSelection row={row} id={`vocabulary-${row.id}`} /></label></td>
        <td role="cell">{row.title}</td>
        <td role="cell">{row.translations.map(language => language.label).join(" · ")}</td>
        <td role="cell"><OpenInStremio row={row} /></td>
      </tr>)}</tbody>
    </table> :
    <table className="subtitle-library__table" role="table" aria-label={`${group.name} subtitles`}>
      <thead role="rowgroup"><tr role="row">
        <th role="columnheader" scope="col">{selectAll}</th>
        <th role="columnheader" scope="col">Episode</th><th role="columnheader" scope="col">Title</th>
        <th role="columnheader" scope="col">Translations</th>
        <th role="columnheader" scope="col"><span className="sr-only">Open episode</span></th>
      </tr></thead>
      <tbody role="rowgroup">{group.rows.map(row => <tr role="row" key={row.id}>
        <td role="cell"><label className="subtitle-library__episode-select"><TitleSelection row={row} id={`vocabulary-${row.id}`} /></label></td>
        <th role="rowheader" scope="row"><label className="subtitle-library__episode-label" htmlFor={`vocabulary-${row.id}`}>{episodeCode(row.season, row.episode)}</label></th>
        <td role="cell">{row.title}</td>
        <td role="cell">{row.translations.map(language => language.label).join(" · ")}</td>
        <td role="cell"><OpenInStremio row={row} /></td>
      </tr>)}</tbody>
    </table>}
  </details>;
}

function LibraryRows({ search, setPublication, stalePublication }) {
  const [request, setRequest] = useState({ cursor: "", publication: "" });
  const [result, setResult] = useState({ rows: [], publication: "", nextCursor: null });
  const recoveredPublication = useRef("");
  const bottom = useRef(null);
  const pending = result.request !== request;
  const error = pending ? "" : result.error;
  const { rows, publication, nextCursor } = result;
  const groupPublication = pending && !request.cursor ? "" : publication;
  const restart = useCallback(stalePublication => {
    if (recoveredPublication.current === stalePublication) return false;
    recoveredPublication.current = stalePublication;
    setRequest({ cursor: "", publication: "" });
    return true;
  }, []);
  useEffect(() => {
    if (publication && stalePublication === publication) restart(publication);
  }, [publication, stalePublication, restart]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const { cursor } = request;
    const query = new URLSearchParams({ search });
    if (cursor) query.set("cursor", cursor);
    fetch(`/api/browse?${query}`, { signal, cache: "no-store" }).then(async response => {
      if (signal.aborted) return;
      const revision = response.headers.get("X-Yomiru-Publication");
      if (cursor && (response.status === 409 || (response.ok && revision !== request.publication))) {
        if (!restart(request.publication)) throw new Error("Could not load the latest subtitle library.");
        return;
      }
      if (!response.ok || !revision) throw new Error("The subtitle library is temporarily unavailable.");
      const page = await response.json();
      if (!Array.isArray(page.rows) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
        throw new Error("The subtitle library is temporarily unavailable.");
      }
      if (signal.aborted) return;
      setResult(previous => ({ request, publication: revision, nextCursor: page.nextCursor,
        rows: cursor ? [...previous.rows, ...page.rows] : page.rows }));
      setPublication(revision);
    }).catch(error => {
      if (signal.aborted) return;
      setResult(previous => ({ ...previous, request, error: error.message }));
      setPublication(previous => previous ?? "");
    });
    return () => controller.abort();
  }, [search, request, setPublication, restart]);

  useEffect(() => {
    if (pending || error || !nextCursor || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRequest(current => current === request ? { cursor: nextCursor, publication } : current);
      }
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [pending, error, nextCursor, publication, request]);

  return <>
    <div className="subtitle-library__groups" aria-busy={pending}>
      {groupEpisodes(rows).map(group => <LibraryGroup key={group.id} group={group} publication={groupPublication}
        onPublicationChange={restart} />)}
    </div>
    <div className="subtitle-library__status" ref={bottom} aria-live="polite">
      {pending ? <p>Loading subtitles…</p> : error ? <p role="alert">{error} <button onClick={() => {
        recoveredPublication.current = "";
        setRequest({ cursor: "", publication: "" });
      }}>Try again</button></p>
        : !rows.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
          : nextCursor ? <button onClick={() => setRequest({ cursor: nextCursor, publication })}>Load more</button> : null}
    </div>
  </>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  const [publication, setPublication] = useState(null);
  const [stalePublication, setStalePublication] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  return <section id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <h2 id="library-title">Subtitle library</h2>
    <label className="sr-only" htmlFor="library-search">Search movies, shows, episode titles or episode codes</label>
    <input id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows, titles, or S01E02" autoComplete="off"
      onChange={event => setValue(event.target.value)} />
    <VocabularySelection publication={publication} onPublicationChange={setStalePublication}>
      <LibraryRows key={search} search={search} setPublication={setPublication} stalePublication={stalePublication} />
    </VocabularySelection>
  </section>;
}
