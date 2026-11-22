import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { episodeCode, groupEpisodes, libraryTitle } from "./library-episodes.mjs";
import { ExerciseButton, VocabularySelection } from "./VocabularySelection.jsx";
import { VocabularyProgress } from "./VocabularyProgress.jsx";
import evangelionCover from "./library-art/evangelion.webp";
import grandBlueCover from "./library-art/grand-blue.webp";
import onePieceCover from "./library-art/one-piece.webp";
import rebuildCover from "./library-art/rebuild.webp";
import foxOutline from "./library-fox-outline.svg";
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
  const remote = row.artwork?.path;
  if (typeof remote === "string" && /^\/library\/[a-f0-9]{64}\.webp$/.test(remote)) {
    return remote;
  }
  const directory = row.type === "movie" ? "movies" : "episodes";
  return titleArt[`./library-art/${directory}/${row.id.replaceAll(":", "-")}.webp`];
}

function GalleryArt({ src, label }) {
  const [failed, setFailed] = useState();
  return <span className="subtitle-library__art" aria-hidden="true">
    {src && failed !== src
      ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
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

function CoverProgress({ id, progress }) {
  if (!progress?.total) return null;
  return <span className="subtitle-library__cover-controls">
    <VocabularyProgress className="subtitle-library__cover-progress" progress={progress} labelId={id} hideLabel />
  </span>;
}

function LibraryGroups({ groups, progressFor, onOpen }) {
  return <ul className="subtitle-library__gallery subtitle-library__gallery--covers" aria-label="Subtitle groups">
    {groups.map(group => {
      const cardId = groupCardId(group.id);
      const progressId = `${cardId}-progress`;
      const progress = progressFor("group", group.id);
      return <li className="subtitle-library__group" key={group.id}>
        <button type="button" className="subtitle-library__group-card" id={cardId}
          aria-labelledby={`${cardId}-name`} aria-describedby={progress?.total ? progressId : undefined}
          onClick={() => onOpen(group.id)}>
          <GalleryArt src={groupArt.get(group.id)} label={group.name} />
        </button>
        <CoverProgress id={progressId} progress={progress} />
        <strong id={`${cardId}-name`} className="subtitle-library__group-name">{group.name}</strong>
        <span className="subtitle-library__meta">{group.movie ? "Film collection" : "Series"}</span>
      </li>;
    })}
  </ul>;
}

function SelectedTitleActions({ row, titles, publication, progressFor }) {
  const progress = row.practiceSupported === true ? progressFor("title", row.id) : null;
  return <div className="subtitle-library__selection-bar" role="region" aria-label="Selected title actions">
    <div className="subtitle-library__selected-title">
      <div className="subtitle-library__selected-details" aria-live="polite">
        {titles.map(title => {
          const code = titleCode(title);
          return <div key={title.id} data-current={title.id === row.id}>
            <strong title={title.title}>{code && `${code} · `}{title.title}</strong>
            <span className="subtitle-library__meta">{title.translations.map(language => language.label).join(" · ")}</span>
          </div>;
        })}
      </div>
      {progress?.total > 0 && <div className="subtitle-library__progress">
        <VocabularyProgress progress={progress} revealLabel />
      </div>}
    </div>
    <div className="subtitle-library__actions">
      <ExerciseButton row={row} disabled={!publication} />
      <ExerciseButton row={row} disabled={!publication} conjugating />
      <a className="install subtitle-library__control subtitle-library__play" href={row.stremioUrl}
        aria-label={`Open in Stremio for ${libraryTitle(row)}`}>
        <span className="install__face" aria-hidden="true">
          <span className="subtitle-library__play-icon" />
        </span>
        <span className="subtitle-library__control-tooltip" aria-hidden="true">Open in Stremio</span>
      </a>
    </div>
  </div>;
}

function LibraryGroupDetail({ group, progressFor, selected, onSelectTitle, heading }) {
  const [season, setSeason] = useState(null);
  const seasons = group.movie ? [] : [...new Set(group.rows.map(row => row.season))];
  const currentSeason = seasons.includes(season) ? season : seasons[0];
  const titles = group.movie ? group.rows : group.rows.filter(row => row.season === currentSeason);
  const languages = [...new Set(titles.flatMap(row => row.translations.map(language => language.label)))];

  return <section className="subtitle-library__detail" aria-labelledby="library-group-title">
    <div className="subtitle-library__detail-heading">
      <div>
        <h3 id="library-group-title" tabIndex={-1} ref={heading}>{group.name}</h3>
        <span className="subtitle-library__meta">{languages.join(" · ")}</span>
      </div>
      {!group.movie && <span className="subtitle-library__season">
          <select aria-label="Season" value={currentSeason} onChange={event => {
            setSeason(Number(event.target.value));
            onSelectTitle(null);
          }}>
            {seasons.map(value => <option key={value} value={value}>Season {value}</option>)}
          </select>
        </span>}
    </div>
    <fieldset className="subtitle-library__title-picker">
      <legend className="sr-only">{group.movie ? "Select a movie" : "Select an episode"}</legend>
      <ul className={`subtitle-library__gallery subtitle-library__gallery--${group.movie ? "covers" : "episodes"}`}>
        {titles.map(row => {
          const code = titleCode(row);
          const captionId = `library-caption-${encodeURIComponent(row.id)}`;
          const progressId = `${captionId}-progress`;
          const progress = row.practiceSupported === true ? progressFor("title", row.id) : null;
          return <li key={row.id}>
            <button type="button" className="subtitle-library__title-card"
              aria-pressed={selected?.id === row.id} aria-labelledby={captionId}
              aria-describedby={progress?.total ? progressId : undefined}
              onClick={() => onSelectTitle(row.id)}>
              <GalleryArt
                src={titleArtwork(row)}
                label={code ? String(row.episode).padStart(2, "0") : undefined} />
              <CoverProgress id={progressId} progress={progress} />
              <span className="subtitle-library__caption" id={captionId}>
                {code && <span className="subtitle-library__code">{code}</span>} {row.title}
              </span>
            </button>
          </li>;
        })}
      </ul>
    </fieldset>
  </section>;
}

function LibraryRows({ active, search, searchInput, summary, setPublication, stalePublication, progressFor, heading }) {
  const [request, setRequest] = useState({ search, cursor: "", publication: "" });
  const [result, setResult] = useState({ rows: [], publication: "", nextCursor: null });
  const [openGroupId, setOpenGroupId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const focusTarget = useRef(null);
  const detailHeading = useRef(null);
  const recoveredPublication = useRef(null);
  const bottom = useRef(null);
  if (request.search !== search) {
    setRequest({ search, cursor: "", publication: "" });
    setOpenGroupId(null);
    setSelectedId(null);
  }
  const pending = active && result.request !== request;
  const error = pending ? "" : result.error;
  const { rows, publication, nextCursor } = result.request?.search === search ? result : { rows: [] };
  const groupPublication = pending && !request.cursor ? "" : publication;
  const restart = useCallback(stalePublication => {
    if (recoveredPublication.current?.search === search
      && recoveredPublication.current.publication === stalePublication) return false;
    recoveredPublication.current = { search, publication: stalePublication };
    setRequest({ search, cursor: "", publication: "" });
    return true;
  }, [search]);
  useEffect(() => {
    if (publication && stalePublication === publication) restart(publication);
  }, [publication, stalePublication, restart]);

  useEffect(() => {
    if (!active) return;
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
      setResult(previous => ({ ...(cursor ? previous : { rows: [] }), request, error: error.message }));
    });
    return () => controller.abort();
  }, [active, search, request, setPublication, restart]);

  useEffect(() => {
    if (pending || error || !nextCursor || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRequest(current => current === request ? { search, cursor: nextCursor, publication } : current);
      }
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [pending, error, nextCursor, publication, request, search]);

  const groups = useMemo(() => groupEpisodes(rows), [rows]);
  const activeGroup = groups.find(group => group.id === openGroupId);
  const activeRows = activeGroup?.rows;
  const activeId = activeGroup?.id;
  const selected = activeRows?.find(row => row.id === selectedId);

  function selectTitle(id) {
    setSelectedId(current => current === id ? null : id);
  }
  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    const target = activeId ? detailHeading.current : document.getElementById(focusTarget.current);
    focusTarget.current = null;
    target?.focus({ preventScroll: Boolean(activeId) });
    if (activeId) heading.current?.closest("#subtitle-library")?.scrollIntoView({ block: "start" });
  }, [activeId, heading]);
  return <div className="subtitle-library__content">
    <h2 ref={heading} id="library-title">{activeGroup
      ? <button type="button" className="subtitle-library__back" onClick={() => {
        focusTarget.current = groupCardId(activeGroup.id);
        setSelectedId(null);
        setOpenGroupId(null);
      }}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 12H4m7 7-7-7 7-7" />
        </svg>
        Library
      </button> : "Library"}</h2>
    {!activeGroup && summary}
    {selected && <SelectedTitleActions row={selected} titles={activeRows}
      publication={groupPublication} progressFor={progressFor} />}
    <div hidden={Boolean(activeGroup)}>{searchInput}</div>
    <div aria-busy={pending}>
      {activeGroup
        ? <LibraryGroupDetail key={activeGroup.id} group={activeGroup}
          progressFor={progressFor} selected={selected} onSelectTitle={selectTitle}
          heading={detailHeading} />
        : groups.length > 0 && <LibraryGroups groups={groups} progressFor={progressFor} onOpen={id => {
            focusTarget.current = "";
            setOpenGroupId(id);
          }} />}
    </div>
    <div className="subtitle-library__status" data-empty={active && !rows.length} ref={bottom} aria-live="polite">
      {!active ? null : pending ? <>
          <div className="subtitle-library__loader" aria-hidden="true">
            <img src={foxOutline} alt="" width="100" height="100" />
            <div className="loading-spinner" />
          </div>
          <span className="sr-only">Loading subtitles…</span>
        </>
        : error ? <p role="alert">{error} <button type="button" onClick={() => {
            recoveredPublication.current = null;
            setRequest({ search, cursor: "", publication: "" });
          }}>Try again</button></p>
          : !rows.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
            : nextCursor ? <button type="button" onClick={() => setRequest({ search, cursor: nextCursor, publication })}>Load more</button> : null}
    </div>
  </div>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(false);
  const heading = useRef(null);
  const [publication, setPublication] = useState("");
  const [stalePublication, setStalePublication] = useState("");
  useEffect(() => {
    if (visible) return;
    if (!window.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(heading.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const searchInput = <div className="subtitle-library__search-field">
    <label className="sr-only" htmlFor="library-search">Search shows, titles, episode codes, or movie codes</label>
    <input id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows, titles, or codes" autoComplete="off"
      onFocus={() => setVisible(true)} onChange={event => { setVisible(true); setValue(event.target.value); }} />
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.25 15.25 4.5 4.5" />
    </svg>
  </div>;
  return <section id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <VocabularySelection publication={publication} onPublicationChange={setStalePublication} active={visible}>
      {(summary, progressFor) => <LibraryRows active={visible} search={search} searchInput={searchInput}
        summary={summary} setPublication={setPublication} stalePublication={stalePublication} progressFor={progressFor}
        heading={heading} />}
    </VocabularySelection>
  </section>;
}
