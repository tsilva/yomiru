import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { episodeCode, filterLibraryRows, groupEpisodes, librarySearchTerms, libraryTitle } from "./library-episodes.mjs";
import { initialLibrarySnapshot, readLibrarySnapshot, saveLibrarySnapshot } from "./library-snapshot.mjs";
import bundledCatalogue from "virtual:yomiru-catalogue";
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

function SelectedTitleSidebar({ row, publication, progressFor, onClose }) {
  const code = titleCode(row);
  const progress = row.practiceSupported === true ? progressFor("title", row.id) : null;
  const heading = useRef(null);
  useLayoutEffect(() => {
    heading.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    function dismiss(event) {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog:modal")) {
        onClose();
      }
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [onClose]);

  return <aside id="library-selected-title" className="subtitle-library__sidebar" aria-labelledby="library-sidebar-title">
    <div className="subtitle-library__sidebar-header">
      <button type="button" className="subtitle-library__sidebar-close" aria-label="Close title details" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
    <div className="subtitle-library__sidebar-content">
      <div className="subtitle-library__sidebar-art" data-movie={row.type === "movie" || undefined}>
        <GalleryArt src={titleArtwork(row)} label={code ? String(row.episode).padStart(2, "0") : undefined} />
      </div>
      <div>
        {code && <span className="subtitle-library__code">{code}</span>}
        <h4 ref={heading} id="library-sidebar-title" tabIndex={-1}>{row.title}</h4>
      </div>
      {progress?.total > 0 && <VocabularyProgress progress={progress} revealLabel />}
      {row.description && <p className="subtitle-library__sidebar-description">{row.description}</p>}
      <div className="subtitle-library__sidebar-actions">
        <a className="install subtitle-library__control" href={row.stremioUrl}
          aria-label={`Open in Stremio for ${libraryTitle(row)}`}>
          <span className="install__face">
            <span className="subtitle-library__play-icon" aria-hidden="true" /> Open in Stremio
          </span>
        </a>
        <GymButton row={row} disabled={!publication} onPracticeReturn={code ? onClose : undefined} />
      </div>
    </div>
  </aside>;
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
          aria-pressed={selected?.id === row.id}
          aria-controls={selected?.id === row.id ? "library-selected-title" : undefined} aria-labelledby={captionId}
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

const PAGE_SIZE = 30;

function LibraryRows({ snapshot, active, error, retry, search, searchInput, summary, progressFor, heading, onNavigate }) {
  const [openGroupId, setOpenGroupId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [previousSearch, setPreviousSearch] = useState(search);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const focusTarget = useRef(null);
  const detailHeading = useRef(null);
  const bottom = useRef(null);
  if (previousSearch !== search) {
    setPreviousSearch(search);
    setOpenGroupId(null);
    setSelectedId(null);
    setLimit(PAGE_SIZE);
  }
  const matchingRows = useMemo(() => filterLibraryRows(snapshot?.rows ?? [],
    { terms: librarySearchTerms(search) }), [snapshot, search]);
  const groups = useMemo(() => groupEpisodes(matchingRows), [matchingRows]);
  const activeGroup = groups.find(group => group.id === openGroupId);
  const { publication } = snapshot ?? {};
  const items = activeGroup?.rows ?? groups;
  const hasMore = items.length > limit;
  const selected = activeGroup?.rows.find(row => row.id === selectedId);
  const pending = active && !snapshot && !error;
  const loadMore = useCallback(() => setLimit(current => current + PAGE_SIZE), []);
  useEffect(() => {
    if (!active || !hasMore || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [active, hasMore, limit, loadMore, activeGroup?.id, search]);

  const closeTitle = useCallback(() => {
    setSelectedId(null);
    document.getElementById(titleCardId(selectedId))?.focus({ preventScroll: true });
  }, [selectedId]);
  function selectTitle(id) {
    if (id === selectedId) closeTitle();
    else setSelectedId(id);
  }
  useLayoutEffect(() => {
    if (focusTarget.current === null) return;
    const target = activeGroup ? detailHeading.current : document.getElementById(focusTarget.current);
    focusTarget.current = null;
    target?.focus({ preventScroll: Boolean(activeGroup) });
    if (activeGroup) heading.current?.closest("#subtitle-library")?.scrollIntoView({ block: "start" });
  }, [activeGroup, heading]);
  return <div className="subtitle-library__content">
    <h2 ref={heading} id="library-title">{activeGroup
      ? <button type="button" className="subtitle-library__back" onClick={() => {
        onNavigate();
        focusTarget.current = groupCardId(activeGroup.id);
        setSelectedId(null);
        setOpenGroupId(null);
        setLimit(PAGE_SIZE);
      }}>
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 12H4m7 7-7-7 7-7" />
        </svg>
        Library
      </button> : "Library"}</h2>
    {!activeGroup && summary}
    <div hidden={Boolean(activeGroup)}>{searchInput}</div>
    <div aria-busy={pending}>
      {activeGroup
        ? <LibraryGroupDetail key={activeGroup.id} group={activeGroup} rows={activeGroup.rows.slice(0, limit)}
          progressFor={progressFor} selected={selected} onSelectTitle={selectTitle}
          heading={detailHeading} />
        : groups.length > 0 && <LibraryGroups groups={groups.slice(0, limit)} progressFor={progressFor} onOpen={id => {
            onNavigate();
            focusTarget.current = "";
            setOpenGroupId(id);
            setLimit(PAGE_SIZE);
          }} />}
    </div>
    <div className="subtitle-library__status" data-empty={active && !items.length} ref={bottom} aria-live="polite">
      {!active ? null : pending ? <>
          <div className="subtitle-library__loader" aria-hidden="true">
            <img src={foxOutline} alt="" width="100" height="100" />
            <div className="loading-spinner" />
          </div>
          <span className="sr-only">Loading subtitles…</span>
        </>
        : !snapshot && error ? <p role="alert">{error} <button type="button" onClick={retry}>Try again</button></p>
          : !items.length ? <p>{search ? "No subtitles match your search." : "No subtitles have been published yet."}</p>
            : hasMore ? <button type="button" onClick={loadMore}>Load more</button> : null}
    </div>
    {selected && <SelectedTitleSidebar key={selected.id} row={selected} publication={publication}
      progressFor={progressFor} onClose={closeTitle} />}
  </div>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const search = value.trim();
  const [visible, setVisible] = useState(false);
  const heading = useRef(null);
  const section = useRef(null);
  const [snapshot, setSnapshot] = useState(() => initialLibrarySnapshot(bundledCatalogue));
  const current = useRef(snapshot);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [stalePublication, setStalePublication] = useState("");
  const refreshActive = Boolean(bundledCatalogue || visible);
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
    if (!refreshActive) return;
    const controller = new AbortController();
    const { signal } = controller;
    const existing = current.current;
    // A site build or saved catalogue can predate descriptions at the same library revision.
    const publication = existing?.publication !== stalePublication
      && existing?.rows.every(row => Object.hasOwn(row, "description")) ? existing.publication : undefined;
    void readLibrarySnapshot({ publication, signal })
      .then(updated => {
        if (!updated || signal.aborted) return;
        const firstLoad = !current.current;
        current.current = updated;
        saveLibrarySnapshot(bundledCatalogue, updated);
        const bounds = section.current.getBoundingClientRect();
        if (firstLoad || existing.publication === updated.publication
          || bounds.top >= window.innerHeight || bounds.bottom <= 0) setSnapshot(updated);
      }).catch(() => {
        if (!signal.aborted && !current.current) setError("The subtitle library is temporarily unavailable.");
      });
    return () => controller.abort();
  }, [refreshActive, stalePublication, attempt]);

  function retry() {
    setError("");
    setAttempt(current => current + 1);
  }

  function applyLatestCatalogue() {
    setSnapshot(current.current);
  }

  const searchInput = <div className="subtitle-library__search-field">
    <label className="sr-only" htmlFor="library-search">Search shows, titles, episode codes, or movie codes</label>
    <input id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows, titles, or codes" autoComplete="off"
      onFocus={() => setVisible(true)} onChange={event => {
        applyLatestCatalogue();
        setVisible(true);
        setValue(event.target.value);
      }} />
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.25 15.25 4.5 4.5" />
    </svg>
  </div>;
  return <section ref={section} id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <VocabularySelection publication={snapshot?.publication ?? ""} onPublicationChange={setStalePublication} active={visible}>
      {(summary, progressFor) => <LibraryRows snapshot={snapshot} active={visible} error={error} retry={retry}
        search={search} searchInput={searchInput} summary={summary} progressFor={progressFor} heading={heading}
        onNavigate={applyLatestCatalogue} />}
    </VocabularySelection>
  </section>;
}
