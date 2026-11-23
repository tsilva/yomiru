import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { episodeCode, groupEpisodes, libraryTitle } from "./library-episodes.mjs";
import { GymButton, VocabularySelection } from "./VocabularySelection.jsx";
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

function titleCardId(id) {
  return `library-title-${encodeURIComponent(id)}`;
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

function SelectedTitleActions({ row, publication, progressFor, onEpisodePracticeReturn }) {
  const code = titleCode(row);
  const progress = row.practiceSupported === true ? progressFor("title", row.id) : null;
  return <div className="subtitle-library__selection-bar" role="region" aria-label="Selected title actions">
    <div className="subtitle-library__selected-title">
      <div className="subtitle-library__selected-details" aria-live="polite">
        <strong title={row.title}>{code && `${code} · `}{row.title}</strong>
      </div>
      {progress?.total > 0 && <div className="subtitle-library__progress">
        <VocabularyProgress progress={progress} revealLabel />
      </div>}
    </div>
    <div className="subtitle-library__actions">
      <GymButton row={row} disabled={!publication} onPracticeReturn={code ? onEpisodePracticeReturn : undefined} />
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

function LibraryTitleGallery({ rows, movie, progressFor, selected, onSelectTitle }) {
  return <ul className={`subtitle-library__gallery subtitle-library__gallery--${movie ? "covers" : "episodes"}`}>
    {rows.map(row => {
      const code = titleCode(row);
      const cardId = titleCardId(row.id);
      const captionId = `${cardId}-caption`;
      const progressId = `${captionId}-progress`;
      const progress = row.practiceSupported === true ? progressFor("title", row.id) : null;
      return <li key={row.id}>
        <button type="button" className="subtitle-library__title-card" id={cardId}
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
  </ul>;
}

function LibraryGroupDetail({ group, rows, heading, ...galleryProps }) {
  const [season, setSeason] = useState(null);
  const languages = [...new Set(rows.flatMap(row => row.translations.map(language => language.label)))];
  const seasons = new Map();
  if (!group.movie) {
    for (const row of rows) {
      if (!seasons.has(row.season)) seasons.set(row.season, []);
      seasons.get(row.season).push(row);
    }
  }

  return <section className="subtitle-library__detail" aria-labelledby="library-group-title">
    <div className="subtitle-library__detail-heading">
      <div className="subtitle-library__detail-title">
        <h3 id="library-group-title" tabIndex={-1} ref={heading}>{group.name}</h3>
        {seasons.size > 0 && <span className="subtitle-library__season-picker">
          <select aria-label="Jump to season" value={seasons.has(season) ? season : seasons.keys().next().value}
            onChange={event => {
              const nextSeason = Number(event.target.value);
              setSeason(nextSeason);
              const target = document.getElementById(`library-season-${nextSeason}`);
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "start" });
            }}>
            {[...seasons.keys()].map(value => <option key={value} value={value}>Season {value}</option>)}
          </select>
        </span>}
      </div>
      {languages.length > 0 && <span className="subtitle-library__meta">{languages.join(" · ")}</span>}
    </div>
    <fieldset className="subtitle-library__title-picker">
      <legend className="sr-only">{group.movie ? "Select a movie" : "Select an episode"}</legend>
      {group.movie ? <LibraryTitleGallery rows={rows} movie {...galleryProps} /> :
        [...seasons].map(([season, episodes]) => <section className="subtitle-library__season" key={season}
          aria-labelledby={`library-season-${season}`}>
          <h4 id={`library-season-${season}`} tabIndex={-1}>Season {season}</h4>
          <LibraryTitleGallery rows={episodes} {...galleryProps} />
        </section>)}
    </fieldset>
  </section>;
}

function useLibraryPages({ active, search, show = "", currentPublication, setPublication, stalePublication }) {
  const [request, setRequest] = useState({ search, show, cursor: "", publication: "" });
  const [result, setResult] = useState({ rows: [], publication: "", nextCursor: null });
  const recoveredPublication = useRef(null);
  const bottom = useRef(null);
  if (request.search !== search || request.show !== show) {
    setRequest({ search, show, cursor: "", publication: "" });
  }
  const pending = active && result.request !== request;
  const error = pending ? "" : result.error;
  const { rows, publication, nextCursor } = result.request?.search === search && result.request.show === show
    ? result : { rows: [] };
  const restart = useCallback(stalePublication => {
    if (recoveredPublication.current?.search === search
      && recoveredPublication.current.show === show
      && recoveredPublication.current.publication === stalePublication) return false;
    recoveredPublication.current = { search, show, publication: stalePublication };
    setRequest({ search, show, cursor: "", publication: "" });
    return true;
  }, [search, show]);
  useEffect(() => {
    if (active && publication && (stalePublication === publication
      || (!pending && currentPublication && currentPublication !== publication))) restart(publication);
  }, [active, pending, publication, currentPublication, stalePublication, restart]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const { signal } = controller;
    const { cursor } = request;
    const query = new URLSearchParams({ search });
    if (show) query.set("show", show);
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
  }, [pending, search, show, request, setPublication, restart]);

  const loadMore = useCallback(() => {
    setRequest(current => current === request ? { search, show, cursor: nextCursor, publication } : current);
  }, [request, search, show, nextCursor, publication]);
  useEffect(() => {
    if (!active || pending || error || !nextCursor || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [active, pending, error, nextCursor, loadMore]);

  return { rows, publication: pending && !request.cursor ? "" : publication, nextCursor, pending, error, bottom, loadMore,
    retry() {
      recoveredPublication.current = null;
      setRequest({ ...request });
    },
  };
}

function LibraryRows({ active, search, searchInput, summary, currentPublication, setPublication, stalePublication, progressFor, heading }) {
  const [openGroupId, setOpenGroupId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [previousSearch, setPreviousSearch] = useState(search);
  const focusTarget = useRef(null);
  const detailHeading = useRef(null);
  if (previousSearch !== search) {
    setPreviousSearch(search);
    setOpenGroupId(null);
    setSelectedId(null);
  }
  const covers = useLibraryPages({ active: active && !openGroupId, search, currentPublication, setPublication, stalePublication });
  const groups = useMemo(() => groupEpisodes(covers.rows), [covers.rows]);
  const activeGroup = groups.find(group => group.id === openGroupId);
  const titles = useLibraryPages({ active: active && Boolean(activeGroup), search, show: openGroupId ?? "",
    currentPublication, setPublication, stalePublication });
  const { rows, publication, nextCursor, pending, error, bottom, loadMore, retry } = activeGroup ? titles : covers;
  const selected = activeGroup ? rows.find(row => row.id === selectedId) : null;

  function selectTitle(id) {
    setSelectedId(current => current === id ? null : id);
  }
  function returnFromEpisodePractice() {
    setSelectedId(null);
    document.getElementById(titleCardId(selectedId))?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    const target = openGroupId ? detailHeading.current : document.getElementById(focusTarget.current);
    focusTarget.current = null;
    target?.focus({ preventScroll: Boolean(openGroupId) });
    if (openGroupId) heading.current?.closest("#subtitle-library")?.scrollIntoView({ block: "start" });
  }, [openGroupId, heading]);
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
    {selected && <SelectedTitleActions row={selected} publication={publication} progressFor={progressFor}
      onEpisodePracticeReturn={returnFromEpisodePractice} />}
    <div hidden={Boolean(activeGroup)}>{searchInput}</div>
    <div aria-busy={pending}>
      {activeGroup
        ? <LibraryGroupDetail key={activeGroup.id} group={activeGroup} rows={rows}
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
        : error ? <p role="alert">{error} <button type="button" onClick={retry}>Try again</button></p>
          : !rows.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
            : nextCursor ? <button type="button" onClick={loadMore}>Load more</button> : null}
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
        summary={summary} currentPublication={publication} setPublication={setPublication}
        stalePublication={stalePublication} progressFor={progressFor}
        heading={heading} />}
    </VocabularySelection>
  </section>;
}
