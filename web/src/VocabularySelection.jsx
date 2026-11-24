import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { DialogClose } from "./DialogClose.jsx";
import { libraryTitle } from "./library-episodes.mjs";
import { VocabularyProgress } from "./VocabularyProgress.jsx";
import { useLibraryMastery } from "./use-library-mastery.mjs";
import { startMobilePracticeFullscreen } from "./mobile-display.mjs";
import { practicePageVersion, sharedPracticeSelectionLimit } from "./practice-deck.mjs";
import { titlePracticePath, unsupportedPracticeMessage } from "./practice-route.mjs";
import { useTitlePractice } from "./use-title-practice.mjs";
import "./vocabulary-selection.css";

const Selection = createContext(null);
const VocabularyBrowser = lazy(() => import("./VocabularyBrowser.jsx").then(module => ({ default: module.VocabularyBrowser })));
const VocabularyPractice = lazy(() => import("./VocabularyPractice.jsx").then(module => ({ default: module.VocabularyPractice })));
class LibraryPublicationChanged extends Error {}

function DumbbellIcon() {
  return <svg viewBox="0 0 24 24" focusable="false">
    <g transform="rotate(-42 12 12)">
      <rect x="2" y="11" width="20" height="2" rx="1" />
      <rect x="2" y="8.5" width="2.5" height="7" rx="1" />
      <rect x="5.5" y="5.5" width="3.5" height="13" rx="1.25" />
      <rect x="15" y="5.5" width="3.5" height="13" rx="1.25" />
      <rect x="19.5" y="8.5" width="2.5" height="7" rx="1" />
    </g>
  </svg>;
}

function ReviewButton({ disabled }) {
  const { setExercise } = useContext(Selection);
  return <button className="install subtitle-library__control" type="button"
    aria-label="Review" title="Review" aria-haspopup="dialog" disabled={disabled}
    onClick={event => setExercise({ trigger: event.currentTarget, endFullscreen: startMobilePracticeFullscreen() })}>
    <span className="install__face" aria-hidden="true"><DumbbellIcon /></span>
  </button>;
}

function GymMode({ label, title, icon, href, unavailableReason, onStart }) {
  const reasonId = useId();
  const props = {
    className: "install subtitle-library__control gym__mode",
    "aria-label": `${label} for ${title}`,
    "aria-haspopup": unavailableReason ? undefined : "dialog",
    "aria-disabled": unavailableReason ? true : undefined,
    "aria-describedby": unavailableReason ? reasonId : undefined,
  };
  const face = <span className="install__face">
    <span className="gym__icon" aria-hidden="true"><DumbbellIcon />{icon}</span>
    <span>
      {label}
      {unavailableReason && <span className="gym__reason" id={reasonId}>{unavailableReason}</span>}
    </span>
  </span>;
  if (href && !unavailableReason) {
    return <a {...props} href={href} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onStart();
    }}>{face}</a>;
  }
  return <button {...props} type="button" onClick={unavailableReason ? undefined : onStart}>{face}</button>;
}

export function GymButton({ row, disabled, onPracticeReturn }) {
  const { setExercise, openTitlePractice, publication } = useContext(Selection);
  const dialog = useRef(null);
  const heading = useRef(null);
  const trigger = useRef(null);
  const headingId = useId();
  const title = libraryTitle(row);
  const practicePath = titlePracticePath(row);
  const loading = disabled ? "The subtitle library is loading." : undefined;

  return <>
    <button ref={trigger} className="install subtitle-library__control" type="button"
      aria-label={`Practice options for ${title}`} aria-haspopup="dialog" onClick={() => {
        trigger.current.focus({ preventScroll: true });
        dialog.current.showModal();
        heading.current.focus({ preventScroll: true });
      }}>
      <span className="install__face" aria-hidden="true"><DumbbellIcon /></span>
      <span className="subtitle-library__control-tooltip" aria-hidden="true">Practice</span>
    </button>
    <dialog ref={dialog} className="gym" aria-labelledby={headingId}>
      <DialogClose label="Close practice options" />
      <div className="gym__content">
        <h3 ref={heading} id={headingId} className="sr-only" tabIndex={-1}>Practice options</h3>
        <div className="gym__modes">
          <GymMode label="Vocabulary" title={title} href={practicePath}
            icon={<span className="gym__icon-mark gym__icon-mark--practice" />}
            unavailableReason={row.practiceSupported !== true ? unsupportedPracticeMessage(row) : loading}
            onStart={() => {
              dialog.current.close();
              openTitlePractice(practicePath, row, publication, onPracticeReturn ??
                (() => trigger.current?.focus({ preventScroll: true })));
            }} />
          <GymMode label="Verbs" title={title}
            icon={<span className="gym__icon-mark" lang="ja">る</span>}
            unavailableReason={!row.vocabulary ? "Subtitle vocabulary is not available for this title yet." : loading}
            onStart={() => {
              dialog.current.close();
              setExercise({ title: row, trigger: trigger.current, endFullscreen: startMobilePracticeFullscreen() });
            }} />
        </div>
      </div>
    </dialog>
  </>;
}

async function requestVocabulary(body, signal) {
  const { mode, publication, practice, titles, order, cursor } = JSON.parse(body);
  const firstPractice = publication && mode === "practice-page" && !order && !practice.after && !practice.checks?.length
    && !practice.review?.length && titles.length <= sharedPracticeSelectionLimit;
  let response;
  if (mode === "practice-review") {
    const query = new URLSearchParams({ mode, publication });
    if (cursor) query.set("cursor", cursor);
    response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  } else if (firstPractice) {
    const query = new URLSearchParams({
      mode, publication, format: practicePageVersion, titles: [...titles].sort().join(","),
    });
    response = await fetch(`/api/vocabulary-selection?${query}`, { signal });
  } else {
    response = await fetch("/api/vocabulary-selection", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
    });
  }
  if (response.ok) return response;
  if (response.status === 409) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
  throw new Error(mode === "practice-review" ? "Review is temporarily unavailable."
    : mode.startsWith("conjugation") ? "Verb Trainer is temporarily unavailable." : "Vocabulary is temporarily unavailable.");
}

export function VocabularySelection({ children, publication, onPublicationChange, active }) {
  const [columnSort, setColumnSort] = useState(null);
  const [browseHistory, setBrowseHistory] = useState(null);
  const [exercise, setExercise] = useState(null);
  useEffect(() => exercise?.endFullscreen, [exercise]);
  const titlePractice = useTitlePractice();
  const retriedPractice = useRef(null);
  const mastery = useLibraryMastery({ publication,
    active, exercising: Boolean(exercise || titlePractice.id), onPublicationChange });
  const { history, historyError, scopeError } = mastery;
  const total = history?.size ?? 0;
  const canBrowse = Boolean(publication && total);
  const libraryProgress = mastery.progressFor("selection");
  const showPracticePrompt = libraryProgress?.total > 0 && total === 0;
  const loadHistoryPage = useCallback(async (historyView, wordIds, query, signal) => {
    try {
      const response = await requestVocabulary(JSON.stringify({
        scope: "all", publication, mode: "page",
        page: { query, category: "", offset: 0, history: true, historyView, wordIds },
      }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [publication, onPublicationChange]);
  const titlePracticeId = titlePractice.id;
  const practicePublication = titlePracticeId ? titlePractice.publication : publication;
  const retryTitle = titlePractice.retry;
  const practiceScope = JSON.stringify({
    scope: "titles", publication: practicePublication, titles: [titlePracticeId],
  });
  const loadDeck = useCallback(async (mode, practice, signal, order) => {
    try {
      const response = await requestVocabulary(JSON.stringify({ ...JSON.parse(practiceScope), mode, practice, order }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== practicePublication) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) {
        onPublicationChange(practicePublication);
        if (titlePracticeId && retriedPractice.current !== practiceScope) {
          retriedPractice.current = practiceScope;
          retryTitle();
        }
      }
      throw failure;
    }
  }, [practiceScope, practicePublication, titlePracticeId, onPublicationChange, retryTitle]);
  const loadReview = useCallback(async (_mode, { cursor }, signal) => {
    try {
      const response = await requestVocabulary(JSON.stringify({ mode: "practice-review", publication, cursor }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [publication, onPublicationChange]);
  const verbTitleId = exercise?.title?.id;
  const loadConjugations = useCallback(async (mode, wordIds, signal) => {
    const scope = mode === "conjugation" ? { scope: "titles", titles: [verbTitleId] } : { scope: "all", wordIds };
    try {
      const response = await requestVocabulary(JSON.stringify({ mode, publication, ...scope }), signal);
      if (response.headers.get("X-Yomiru-Publication") !== publication) throw new LibraryPublicationChanged("The library changed while loading vocabulary.");
      return await response.json();
    } catch (failure) {
      if (!signal.aborted && failure instanceof LibraryPublicationChanged) onPublicationChange(publication);
      throw failure;
    }
  }, [publication, verbTitleId, onPublicationChange]);
  const summaryBar = (
    <div className="vocabulary-selection" role="region" aria-label="Your vocabulary">
      <div className="vocabulary-selection__summary" aria-live="polite" aria-atomic="true">
        <div className="vocabulary-selection__progress">
          {libraryProgress?.total > 0 ? <VocabularyProgress progress={libraryProgress} showCounts hideLabel />
            : <strong>{historyError || scopeError ? "Vocabulary progress unavailable"
              : libraryProgress === undefined ? "Loading vocabulary…" : "No reviewed Practice available"}</strong>}
        </div>
        <span className="vocabulary-selection__prompt" data-visible={showPracticePrompt}
          aria-hidden={!showPracticePrompt}>Start Practice on an episode to build your vocabulary.</span>
      </div>
      <div className="vocabulary-selection__actions">
        <ReviewButton disabled={!publication} />
        <button type="button" className="install subtitle-library__control" aria-label="Browse words" title="Browse words"
          disabled={!canBrowse} aria-haspopup="dialog" onClick={() => setBrowseHistory(history)}>
          <span className="install__face" aria-hidden="true">
            <svg className="subtitle-library__book" viewBox="0 0 24 24" focusable="false">
              <path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v14" />
            </svg>
          </span>
        </button>
      </div>
      {(historyError || scopeError) && <p className="vocabulary-selection__note" role="alert">
        {historyError || scopeError} <button type="button" onClick={mastery.retry}>Try again</button>
      </p>}
    </div>
  );
  return <Selection.Provider value={{ setExercise, openTitlePractice: titlePractice.open, publication }}>
    {children(summaryBar, mastery.progressFor)}
    <Suspense fallback={null}>
      {browseHistory && <VocabularyBrowser key={publication} loadHistoryPage={loadHistoryPage}
        loadReview={loadReview} history={browseHistory}
        onClose={() => setBrowseHistory(null)} columnSort={columnSort} onColumnSort={setColumnSort} />}
      {titlePracticeId && <VocabularyPractice key={titlePracticeId} title={titlePractice.title}
        loadDeck={practicePublication ? loadDeck : null} error={titlePractice.error} onRetry={retryTitle}
        unsupported={titlePractice.unsupported}
        onClose={titlePractice.close} />}
      {exercise && !titlePracticeId && <VocabularyPractice
        loadReview={publication ? loadReview : null}
        loadConjugations={publication ? loadConjugations : null} title={exercise.title} conjugating={Boolean(exercise.title)}
        vocabularyWords={exercise.title ? mastery.wordsFor("title", exercise.title.id) : mastery.wordsFor("selection")}
        onClose={() => {
          setExercise(null);
          requestAnimationFrame(() => exercise.trigger.focus({ preventScroll: true }));
        }} />}
    </Suspense>
  </Selection.Provider>;
}
