import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { episodeCode, groupEpisodes } from "./library-episodes.mjs";
import { TitleSelection, ShowSelection, VocabularySelection } from "./VocabularySelection.jsx";
import { formatMastery } from "./library-mastery.mjs";
import "./subtitle-library.css";

function OpenInStremio({ row }) {
  const title = row.type === "movie" ? row.title : `${row.show}, season ${row.season}, episode ${row.episode}`;
  return <a className="install subtitle-library__play" href={row.stremioUrl} title="Open in Stremio"
    aria-label={`Open ${title} in Stremio`}>
    <span className="install__face" aria-hidden="true" />
  </a>;
}

function LibraryMastery({ score, group }) {
  const status = score === undefined ? "Loading mastery" : "Mastery unavailable";
  return <div className="subtitle-library__mastery" title={score == null ? status : undefined}>
    <div className="subtitle-library__mastery-meter">
      {typeof score === "number" ? <>
        <progress max={100} value={score} aria-hidden="true" />
        <span className="subtitle-library__mastery-value">
          <span className="sr-only">{group ? "Group mastery " : "Mastery "}</span>{formatMastery(score)}
        </span>
      </> : <span className="subtitle-library__mastery-placeholder">
        {score === "unpracticed" ? "Not practiced" : <><span aria-hidden="true">—</span><span className="sr-only">{status}</span></>}
      </span>}
    </div>
    {group && <span className="subtitle-library__mastery-scope">Full group</span>}
  </div>;
}

function LibraryGroup({ group, publication, pending, onPublicationChange, open, onToggle, masteryScore }) {
  return <tbody className="subtitle-library__show" role="rowgroup" aria-busy={pending}>
    <tr className="subtitle-library__group-row" role="row">
      <th className="subtitle-library__group-heading" role="rowheader" scope="rowgroup" colSpan={4}>
        <div>
          <ShowSelection key={publication} group={group} publication={publication}
            onPublicationChange={onPublicationChange} />
          <button type="button" aria-expanded={open} onClick={onToggle}>
            {group.name}
          </button>
        </div>
      </th>
      <td className="subtitle-library__group-mastery" role="cell" colSpan={2}>
        <LibraryMastery score={masteryScore("group", group.id)} group />
      </td>
    </tr>
    {open && group.rows.map(row => <tr className="subtitle-library__title-row" role="row" key={row.id}>
      <td className="subtitle-library__select" role="cell">
        <label className="subtitle-library__episode-select"><TitleSelection row={row} id={`vocabulary-${row.id}`} /></label>
      </td>
      <th className="subtitle-library__code" role="rowheader" scope="row">
        <label className="subtitle-library__code-label" htmlFor={`vocabulary-${row.id}`}>
          {group.movie ? row.code : episodeCode(row.season, row.episode)}
        </label>
      </th>
      <td className="subtitle-library__title" role="cell">{row.title}</td>
      <td className="subtitle-library__translations" role="cell">{row.translations.map(language => language.label).join(" · ")}</td>
      <td className="subtitle-library__title-mastery" role="cell">
        <LibraryMastery score={row.vocabulary ? masteryScore("title", row.id) : null} />
      </td>
      <td className="subtitle-library__action" role="cell"><OpenInStremio row={row} /></td>
    </tr>)}
  </tbody>;
}

function LibraryRows({ search, setCatalogue, stalePublication, masteryScore, setMasteryScopes }) {
  const [request, setRequest] = useState({ cursor: "", publication: "" });
  const [result, setResult] = useState({ rows: [], publication: "", nextCursor: null });
  // Search reveals matching groups until the viewer explicitly opens one.
  const [openGroupId, setOpenGroupId] = useState(search ? undefined : null);
  const [closedSearchGroupIds, setClosedSearchGroupIds] = useState([]);
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
      setCatalogue(previous => ({
        publication: revision, summary: page.vocabularySummary
          ?? (previous.publication === revision ? previous.summary : null),
      }));
    }).catch(error => {
      if (signal.aborted) return;
      setResult(previous => ({ ...previous, request, error: error.message }));
      setCatalogue(previous => previous.publication === null ? { publication: "", summary: null } : previous);
    });
    return () => controller.abort();
  }, [search, request, setCatalogue, restart]);

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

  const autoExpand = openGroupId === undefined;
  const groups = useMemo(() => groupEpisodes(rows).map(group => ({
    ...group, open: autoExpand ? !closedSearchGroupIds.includes(group.id) : openGroupId === group.id,
  })), [rows, autoExpand, openGroupId, closedSearchGroupIds]);
  useEffect(() => {
    if (!groupPublication) return;
    setMasteryScopes({ publication: groupPublication, groups: groups.map(group => group.id),
      titles: groups.flatMap(group => group.open ? group.rows.filter(row => row.vocabulary).map(row => row.id) : []) });
  }, [groupPublication, groups, setMasteryScopes]);
  return <>
    {groups.map(group => {
      const { open } = group;
      return <LibraryGroup key={group.id} group={group} publication={groupPublication}
        pending={pending} onPublicationChange={restart} open={open} masteryScore={masteryScore} onToggle={() => {
          if (open && autoExpand) {
            setClosedSearchGroupIds(ids => [...ids, group.id]);
          } else {
            setOpenGroupId(open ? null : group.id);
          }
        }} />;
    })}
    <tbody role="rowgroup"><tr role="row"><td className="subtitle-library__status" role="cell" colSpan={6}>
      <div ref={bottom} aria-live="polite">
        {pending ? <p>Loading subtitles…</p> : error ? <p role="alert">{error} <button onClick={() => {
          recoveredPublication.current = "";
          setRequest({ cursor: "", publication: "" });
        }}>Try again</button></p>
          : !rows.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
            : nextCursor ? <button onClick={() => setRequest({ cursor: nextCursor, publication })}>Load more</button> : null}
      </div>
    </td></tr></tbody>
  </>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(false);
  const searchField = useRef(null);
  const [{ publication, summary }, setCatalogue] = useState({ publication: null, summary: null });
  const [stalePublication, setStalePublication] = useState("");
  const [masteryScopes, setMasteryScopes] = useState(null);
  useEffect(() => {
    if (visible) return;
    if (!window.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(searchField.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  return <section id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <h2 id="library-title">Subtitle library</h2>
    <label className="sr-only" htmlFor="library-search">Search shows, titles, episode codes, or movie codes</label>
    <input ref={searchField} id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows, titles, or codes" autoComplete="off"
      onFocus={() => setVisible(true)} onChange={event => { setVisible(true); setValue(event.target.value); }} />
    <VocabularySelection publication={publication} initialSummary={summary} onPublicationChange={setStalePublication}
      masteryScopes={masteryScopes} active={visible}>
      {(summary, masteryScore) => <table className="subtitle-library__table" role="table" aria-label="Published subtitles">
        <colgroup><col className="subtitle-library__select-column" /><col className="subtitle-library__code-column" />
          <col /><col className="subtitle-library__translations-column" /><col className="subtitle-library__mastery-column" />
          <col className="subtitle-library__action-column" />
        </colgroup>
        <thead className="subtitle-library__header" role="rowgroup">
          <tr role="row"><td className="subtitle-library__summary-cell" role="cell" colSpan={6}>{summary}</td></tr>
          <tr className="subtitle-library__columns" role="row">
            <th role="columnheader" scope="col"><span className="sr-only">Select vocabulary</span></th>
            <th className="subtitle-library__code" role="columnheader" scope="col">Code</th>
            <th role="columnheader" scope="col">Title</th>
            <th role="columnheader" scope="col">Translations</th>
            <th role="columnheader" scope="col">Mastery</th>
            <th role="columnheader" scope="col"><span className="sr-only">Open in Stremio</span></th>
          </tr>
        </thead>
        {visible && <LibraryRows key={search} search={search} setCatalogue={setCatalogue} stalePublication={stalePublication}
          masteryScore={masteryScore} setMasteryScopes={setMasteryScopes} />}
      </table>}
    </VocabularySelection>
  </section>;
}
