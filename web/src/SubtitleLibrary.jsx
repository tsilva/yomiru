import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { episodeCode, groupEpisodes, libraryTitle } from "./library-episodes.mjs";
import { ExerciseButton, GroupFavorite, TitleFavorite, VocabularySelection } from "./VocabularySelection.jsx";
import { formatMastery } from "./library-mastery.mjs";
import evangelionCover from "./library-art/evangelion.webp";
import grandBlueCover from "./library-art/grand-blue.webp";
import onePieceCover from "./library-art/one-piece.webp";
import rebuildCover from "./library-art/rebuild.webp";
import "./subtitle-library.css";

const groupArt = new Map([
  ["tt0112159", evangelionCover],
  ["tt8086718", grandBlueCover],
  ["movie:One Piece Movies", onePieceCover],
  ["movie:Rebuild of Evangelion", rebuildCover],
]);

const titleArt = import.meta.glob(
  ["./library-art/episodes/*.webp", "./library-art/movies/*.webp"],
  { eager: true, import: "default", query: "?url" },
);

function titleArtwork(row) {
  const directory = row.type === "movie" ? "movies" : "episodes";
  return titleArt[`./library-art/${directory}/${row.id.replaceAll(":", "-")}.webp`];
}

function GalleryArt({ src, label }) {
  const [failed, setFailed] = useState(false);
  return <span className="subtitle-library__art" aria-hidden="true">
    {src && !failed
      ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : label ? <span className="subtitle-library__placeholder">{label}</span>
      : <svg className="subtitle-library__film-icon" viewBox="0 0 24 24" focusable="false"
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4M7 12h10" />
        </svg>}
  </span>;
}

function titleCode(row) {
  return row.type === "movie" ? null : episodeCode(row.season, row.episode);
}

function groupCardId(id) {
  return `library-group-${encodeURIComponent(id)}`;
}

function LibraryMastery({ score, group }) {
  const status = score === undefined ? "Loading mastery" : "Mastery unavailable";
  return <div className="subtitle-library__mastery" title={score == null ? status : undefined}>
    <div className="subtitle-library__mastery-meter">
      {typeof score === "number" ? <>
        <progress className="mastery-bar" max={100} value={score} aria-hidden="true" />
        <span className="subtitle-library__mastery-value">
          <span className="sr-only">{group ? "Group mastery " : "Mastery "}</span>{formatMastery(score)}
        </span>
      </> : <span className="subtitle-library__mastery-placeholder">
        {score === "unpracticed" ? "Not practiced" : <><span aria-hidden="true">—</span><span className="sr-only">{status}</span></>}
      </span>}
    </div>
  </div>;
}

function LibraryGroups({ groups, publication, restart, masteryScore, onOpen }) {
  return <ul className="subtitle-library__gallery subtitle-library__gallery--covers" aria-label="Subtitle groups">
    {groups.map(group => <li className="subtitle-library__group" key={group.id}>
      <button type="button" className="subtitle-library__group-card" id={groupCardId(group.id)}
        aria-label={group.name} onClick={() => onOpen(group.id)}>
        <GalleryArt src={groupArt.get(group.id)} label={group.name} />
        <strong className="subtitle-library__group-name">{group.name}</strong>
        <span className="subtitle-library__meta">{group.movie ? "Film collection" : "Series"}</span>
      </button>
      <div className="subtitle-library__group-controls">
        <LibraryMastery group score={masteryScore("group", group.id)} />
        <GroupFavorite key={publication} group={group} publication={publication} onPublicationChange={restart} />
      </div>
    </li>)}
  </ul>;
}

function SelectedTitleActions({ row, titles, publication, masteryScore }) {
  return <div className="subtitle-library__selection-bar" role="region" aria-label="Selected title actions">
    <div className="subtitle-library__selected-title">
      <TitleFavorite row={row} />
      <div className="subtitle-library__selected-details" aria-live="polite">
        {titles.map(title => {
          const code = titleCode(title);
          return <div key={title.id} data-current={title.id === row.id}>
            <strong title={title.title}>{code && `${code} · `}{title.title}</strong>
            <span className="subtitle-library__meta">{title.translations.map(language => language.label).join(" · ")}</span>
          </div>;
        })}
      </div>
      <LibraryMastery score={row.vocabulary ? masteryScore("title", row.id) : null} />
    </div>
    <div className="subtitle-library__actions">
      <ExerciseButton row={row} disabled={!publication} showLabel />
      <a className="subtitle-library__play" href={row.stremioUrl}
        aria-label={`Open in Stremio for ${libraryTitle(row)}`}>
        Open in Stremio
      </a>
    </div>
  </div>;
}

function LibraryGroupDetail({ group, publication, restart, selected, onSelectTitle, onBack, heading }) {
  const [season, setSeason] = useState(null);
  const seasons = group.movie ? [] : [...new Set(group.rows.map(row => row.season))];
  const currentSeason = seasons.includes(season) ? season : seasons[0];
  const titles = group.movie ? group.rows : group.rows.filter(row => row.season === currentSeason);
  const languages = [...new Set(titles.flatMap(row => row.translations.map(language => language.label)))];

  return <section className="subtitle-library__detail" aria-labelledby="library-group-title">
    <button type="button" className="subtitle-library__back" onClick={onBack}>
      <span aria-hidden="true">←</span> Library
    </button>
    <div className="subtitle-library__detail-heading">
      <div>
        <h3 id="library-group-title" tabIndex={-1} ref={heading}>{group.name}</h3>
        <span className="subtitle-library__meta">{languages.join(" · ")}</span>
      </div>
      <div className="subtitle-library__detail-controls">
        <GroupFavorite key={publication} group={group} publication={publication} onPublicationChange={restart} />
        {!group.movie && <span className="subtitle-library__season">
          <select aria-label="Season" value={currentSeason} onChange={event => {
            setSeason(Number(event.target.value));
            onSelectTitle(null);
          }}>
            {seasons.map(value => <option key={value} value={value}>Season {value}</option>)}
          </select>
        </span>}
      </div>
    </div>
    <fieldset className="subtitle-library__title-picker">
      <legend className="sr-only">{group.movie ? "Select a movie" : "Select an episode"}</legend>
      <ul className={`subtitle-library__gallery subtitle-library__gallery--${group.movie ? "covers" : "episodes"}`}>
        {titles.map(row => {
          const code = titleCode(row);
          return <li key={row.id}>
            <button type="button" className="subtitle-library__title-card"
              aria-pressed={selected?.id === row.id}
              onClick={() => onSelectTitle(row.id)}>
              <GalleryArt
                src={titleArtwork(row)}
                label={code ? String(row.episode).padStart(2, "0") : undefined} />
              <span className="subtitle-library__caption">
                {code && <span className="subtitle-library__code">{code}</span>} {row.title}
              </span>
            </button>
          </li>;
        })}
      </ul>
    </fieldset>
  </section>;
}

function LibraryRows({ search, summary, setPublication, stalePublication, masteryScore, setMasteryScopes }) {
  const [request, setRequest] = useState({ cursor: "", publication: "" });
  const [result, setResult] = useState({ rows: [], publication: "", nextCursor: null });
  const [openGroupId, setOpenGroupId] = useState(search ? undefined : null);
  const [titleSelection, setTitleSelection] = useState({ id: null, active: false });
  const focusTarget = useRef(null);
  const detailHeading = useRef(null);
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

  const groups = useMemo(() => groupEpisodes(rows), [rows]);
  // A single matching group can open once the complete search is known.
  const activeGroup = openGroupId === undefined && !nextCursor && groups.length === 1
    ? groups[0] : groups.find(group => group.id === openGroupId);
  const activeRows = activeGroup?.rows;
  const activeId = activeGroup?.id;
  const activeMovie = activeGroup?.movie;
  const actionTitle = activeRows?.find(row => row.id === titleSelection.id);
  const selected = titleSelection.active ? actionTitle : null;

  function selectTitle(id) {
    // Keep the outgoing title visible as its actions fade out.
    setTitleSelection(current => ({
      id: id ?? current.id,
      active: id !== null && (id !== current.id || !current.active),
    }));
  }
  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    const target = activeId ? detailHeading.current : document.getElementById(focusTarget.current);
    focusTarget.current = null;
    target?.focus({ preventScroll: activeMovie });
    if (activeMovie) target?.closest(".subtitle-library__detail")?.scrollIntoView({ block: "start" });
  }, [activeId, activeMovie]);
  useEffect(() => {
    if (!groupPublication) return;
    setMasteryScopes({ publication: groupPublication, groups: groups.map(group => group.id),
      titles: activeRows?.filter(row => row.vocabulary).map(row => row.id) ?? [] });
  }, [groupPublication, groups, activeRows, setMasteryScopes]);

  return <div>
    <div className="subtitle-library__action-slot" data-title-selected={Boolean(selected)}>
      <div className="subtitle-library__action-panel" inert={Boolean(selected)}>{summary}</div>
      {activeRows?.length > 0 && <div className="subtitle-library__action-panel" inert={!selected}>
        <SelectedTitleActions row={actionTitle ?? activeRows[0]} titles={activeRows}
          publication={groupPublication} masteryScore={masteryScore} />
      </div>}
    </div>
    <div aria-busy={pending}>
      {activeGroup
        ? <LibraryGroupDetail key={activeGroup.id} group={activeGroup} publication={groupPublication}
          restart={restart} selected={selected} onSelectTitle={selectTitle} heading={detailHeading} onBack={() => {
            focusTarget.current = groupCardId(activeGroup.id);
            selectTitle(null);
            setOpenGroupId(null);
          }} />
        : <LibraryGroups groups={groups} publication={groupPublication} restart={restart}
          masteryScore={masteryScore} onOpen={id => {
            focusTarget.current = "";
            setOpenGroupId(id);
          }} />}
      <div className="subtitle-library__status" ref={bottom} aria-live="polite">
        {pending ? <p>Loading subtitles…</p> : error ? <p role="alert">{error} <button type="button" onClick={() => {
          recoveredPublication.current = "";
          setRequest({ cursor: "", publication: "" });
        }}>Try again</button></p>
          : !rows.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
            : nextCursor ? <button type="button" onClick={() => setRequest({ cursor: nextCursor, publication })}>Load more</button> : null}
      </div>
    </div>
  </div>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(false);
  const searchField = useRef(null);
  const [publication, setPublication] = useState("");
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
    <VocabularySelection publication={publication} onPublicationChange={setStalePublication}
      masteryScopes={masteryScopes} active={visible}>
      {(summary, masteryScore) => visible
        ? <LibraryRows key={search} search={search} summary={summary} setPublication={setPublication}
          stalePublication={stalePublication} masteryScore={masteryScore} setMasteryScopes={setMasteryScopes} />
        : summary}
    </VocabularySelection>
  </section>;
}
