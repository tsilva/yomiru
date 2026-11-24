import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { episodeCode } from "./library-episodes.mjs";
import { timestamp } from "./EpisodeTimeline.jsx";
import { masteryAt, nextPracticeCards, shufflePracticeItems } from "./vocabulary-practice.mjs";
import { reviewedVocabularyProgress } from "./library-mastery.mjs";
import { deckPracticeStats } from "./practice-deck.mjs";
import { usePracticeDeck } from "./use-practice-deck.mjs";
import { readConjugationProgress, readPracticeProgress, savePracticeAppearances, savePracticeOutcome, savePracticeTeaching }
  from "./vocabulary-practice-storage.mjs";
import { VocabularyQuiz } from "./VocabularyQuiz.jsx";
import { VocabularyProgress } from "./VocabularyProgress.jsx";
import { PracticeComboFox } from "./PracticeComboFox.jsx";
import matchSuccessSound from "./match-success.wav";
import practiceFox from "./practice-fox.svg";
import "./vocabulary-practice.css";

const keys = ["1", "2", "3", "4"];
const correctFeedbackMs = 225;
const tapVibrationMs = 35;
const practiceGames = { quiz: VocabularyQuiz, matching: MatchingGame };
const defaultPracticeGame = "quiz";

function practiceCapacity() {
  if (window.matchMedia("(max-width: 640px) and (min-height: 720px)").matches) return 6;
  if (window.matchMedia("(max-width: 640px) and (min-height: 640px)").matches) return 5;
  return keys.length;
}

function shortcutLanguage(selected) {
  return selected?.language === "ja" ? "en" : "ja";
}

function fillVacancies(row, slots) {
  let next = 0;
  return row.map(slot => slot ?? slots[next++] ?? null);
}

function hasTileFeedback(board) {
  return board?.ja.some(slot => slot?.feedback) || board?.en.some(slot => slot?.feedback);
}

function PracticeLoading() {
  return <div className="practice__loading" role="status">
    <img src={practiceFox} width="480" height="400" alt="" />
    <span>Loading practice…</span>
    <span className="practice__loading-dots" aria-hidden="true"><span /><span /><span /></span>
  </div>;
}

function PracticeRow({ language, slots, selected, onPick, onFeedbackEnd }) {
  const label = language === "ja" ? "Japanese" : "English";
  const shortcuts = slots.length === keys.length && language === shortcutLanguage(selected) ? keys : [];
  return <div className={`practice__row practice__row--${language}`} role="group" aria-label={label}>
    {slots.map((slot, index) => {
      const feedback = slot?.feedback;
      const departing = feedback === "correct";
      const completionAnimation = feedback === "incorrect" ? "practice-incorrect"
        : departing && language === "ja" ? "practice-fade-out" : null;
      return <div className="practice__slot" key={slot?.id ?? index} data-refill={slot?.refill || undefined}
        data-departing={departing || undefined}
        style={departing ? { "--practice-feedback-time": `${correctFeedbackMs}ms` } : undefined}
        onAnimationEnd={completionAnimation ? event => {
          if (event.animationName === completionAnimation) onFeedbackEnd(language, slot.id);
        } : undefined}>
        {slot && <button type="button" className="practice__tile"
          aria-keyshortcuts={!feedback ? shortcuts[index] : undefined}
          aria-disabled={feedback ? true : undefined} tabIndex={feedback ? -1 : undefined}
          aria-pressed={selected?.language === language && selected.id === slot.id}
          data-feedback={feedback}
          onClick={({ nativeEvent }) => {
            const touch = nativeEvent.pointerType === "touch" || nativeEvent.sourceCapabilities?.firesTouchEvents === true;
            onPick(language, index, touch);
          }}>
          {shortcuts[index] && <kbd aria-hidden="true">{shortcuts[index]}</kbd>}
          {language === "ja" ? <>
            <span lang="ja">{slot.card.kana}</span><small lang="ja-Latn">{slot.card.romaji}</small>
          </> : <span lang="en">{slot.card.meaning}</span>}
        </button>}
      </div>;
    })}
  </div>;
}

function MatchingGame({ practice, progress, loading, dialogRef, onComboOutcome, playSuccessSound, saveAppearances,
  saveOutcome, singleTitle }) {
  const [board, setBoard] = useState(null);
  const [selected, setSelected] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const playing = useRef({ board: null, selected: null, turn: 0, lastPlayed: new Map(), timer: null });
  const boardRef = useRef(null);
  const focused = useRef(false);
  const cards = practice.deck?.cards;

  function updateBoard(next) {
    playing.current.board = next;
    setBoard(next);
  }

  function addCards(pool, base, capacity = base?.ja.length ?? practiceCapacity()) {
    const now = Date.now();
    const fresh = !base;
    const active = base?.ja.filter(Boolean).map(slot => slot.card) ?? [];
    const { turn, lastPlayed } = playing.current;
    const vacancies = capacity - active.length;
    const incoming = nextPracticeCards(pool, progress, active, lastPlayed, turn, vacancies, now, fresh);
    const slots = incoming.map(card => ({ card, refill: !fresh, enteredAt: turn, id: crypto.randomUUID() }));
    if (slots.length) saveAppearances(slots, now);
    const empty = Array(capacity).fill(null);
    let size = Math.max(base?.size ?? 0, active.length + slots.length);
    if (fresh && size === 1 && lastPlayed.size) {
      // A rebuild can temporarily leave one pair while the most recent miss cools down.
      size = nextPracticeCards(pool, progress, [], new Map(), 0, 2, now, true).length;
    }
    return { pool, size,
      ja: fillVacancies(base?.ja ?? empty, slots), en: fillVacancies(base?.en ?? empty, shufflePracticeItems(slots)) };
  }

  const startBoard = useEffectEvent(() => {
    const current = playing.current;
    const pool = cards;
    // Keep the current positions intact while tile feedback is visible.
    if (!pool || hasTileFeedback(current.board)) return;
    const capacity = practiceCapacity();
    if (!current.board || current.board.ja.length !== capacity
      || (current.board.size < 2 && current.board.pool !== pool)) {
      current.selected = null;
      setSelected(null);
      focused.current = false;
      updateBoard(addCards(pool, null, capacity));
    } else if (current.board.pool !== pool && current.board.ja.some(slot => !slot)) {
      updateBoard(addCards(pool, current.board, capacity));
    }
  });
  useEffect(() => {
    const onResize = () => startBoard();
    startBoard();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cards]);
  const requestMore = useEffectEvent(() => { if (!practice.error) void practice.refill(true); });
  useEffect(() => {
    if (board && board.ja.filter(Boolean).length < 2) requestMore();
  }, [board]);
  useEffect(() => {
    const current = playing.current;
    return () => { clearTimeout(current.timer); };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    const clearSelection = event => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (!playing.current.selected) return;
      event.preventDefault();
      playing.current.selected = null;
      setSelected(null);
    };
    dialog.addEventListener("keydown", clearSelection);
    dialog.addEventListener("cancel", clearSelection);
    return () => {
      dialog.removeEventListener("keydown", clearSelection);
      dialog.removeEventListener("cancel", clearSelection);
    };
  }, [dialogRef]);
  useLayoutEffect(() => {
    if (board?.size >= 2 && !focused.current) {
      focused.current = true;
      boardRef.current.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [board]);

  function finishFeedback(language, id) {
    const current = playing.current;
    const row = current.board[language];
    const tile = row.find(slot => slot?.id === id);
    if (!tile?.feedback) return;
    const matched = tile.feedback === "correct";
    if (matched) practice.onAttempt(tile.card);
    const next = matched
      ? { ...current.board, ja: current.board.ja.map(slot => slot?.id === id ? null : slot),
        en: current.board.en.map(slot => slot?.id === id ? null : slot) }
      : { ...current.board, [language]: row.map(slot => slot === tile ? { ...tile, feedback: undefined } : slot) };
    const pool = cards ?? next.pool;
    const capacity = practiceCapacity();
    const rebuild = capacity !== next.ja.length;
    const stillAnimating = hasTileFeedback(next);
    const activeElement = document.activeElement;
    if (boardRef.current?.contains(activeElement)
      && ((rebuild && !stillAnimating) || (matched && activeElement.dataset.feedback === "correct"))) {
      boardRef.current.focus({ preventScroll: true });
    }
    if (rebuild && !stillAnimating) {
      current.selected = null;
      setSelected(null);
      updateBoard(addCards(pool, null, capacity));
    } else updateBoard(matched && !rebuild ? addCards(pool, next) : next);
  }

  function pick(language, index, touch = false) {
    const current = playing.current;
    if (current.timer !== null) return;
    const slot = current.board?.[language][index];
    if (!slot || slot.feedback) return;
    if (touch) navigator.vibrate?.(tapVibrationMs);
    const selection = current.selected;
    if (!selection || selection.language === language) {
      current.selected = selection?.id === slot.id ? null : { language, id: slot.id };
      setSelected(current.selected);
      return;
    }
    const first = current.board[selection.language].find(item => item?.id === selection.id);
    const entry = current.board.ja.find(item => item?.id === selection.id);
    if (!first || !entry) return;
    const japanese = language === "ja" ? slot : first;
    const english = language === "en" ? slot : first;
    const correct = japanese.id === english.id;
    if (correct) playSuccessSound();
    const matchingRow = current.board[language].filter(item => item && !item.feedback && item.refill === entry.refill);
    // The newest single refill gives its answer away. Older refills are practice evidence only.
    const choices = !entry.refill ? matchingRow.length
      : entry.enteredAt === current.turn ? 1 : Math.min(2, matchingRow.length);
    const last = current.lastPlayed.get(entry.card.id)?.turn ?? -Infinity;
    const spaced = current.turn - last >= Math.min(2, current.board.size - 1);
    if (!entry.missed) {
      saveOutcome(entry, { correct, choices, spaced });
    }

    current.lastPlayed.set(entry.card.id, { turn: ++current.turn, correct });
    current.selected = null;
    setSelected(null);
    const feedback = correct ? "correct" : "incorrect";
    updateBoard({ ...current.board,
      ja: current.board.ja.map(item => {
        const missed = !correct && item === entry;
        if (item === japanese) return { ...item, feedback, missed: item.missed || missed };
        return missed ? { ...item, missed: true } : item;
      }),
      en: current.board.en.map(item => item === english ? { ...item, feedback } : item) });
    if (correct) {
      if (!entry.missed) onComboOutcome("correct");
      setAnnouncement(`${entry.card.kana} matched.`);
      current.timer = setTimeout(() => { current.timer = null; }, correctFeedbackMs);
    } else {
      onComboOutcome("miss");
      setAnnouncement("Those tiles didn’t match. Try again when they reset.");
    }
  }

  function handleKey(event) {
    const current = playing.current;
    if (current.board?.ja.length !== keys.length) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    const index = keys.indexOf(event.key);
    if (index === -1) return;
    event.preventDefault();
    pick(shortcutLanguage(current.selected), index);
  }

  if (!board) return practice.error ? null : loading;
  return <div onKeyDown={handleKey}>
    {board.size < 2 ? (practice.deck?.next ? (practice.error ? null : loading)
      : <p role="status">{singleTitle ? "This title has too few distinct word pairs to practice."
        : "Choose more titles to practice with distinct word pairs."}</p>) : (
      <div className="practice__board" ref={boardRef} tabIndex={-1} aria-label="Vocabulary matching board"
        style={{ "--practice-rows": board.ja.length }}>
        <PracticeRow language="ja" slots={board.ja} selected={selected} onPick={pick} onFeedbackEnd={finishFeedback} />
        <PracticeRow language="en" slots={board.en} selected={selected} onPick={pick} onFeedbackEnd={finishFeedback} />
      </div>
    )}
    <span className="practice__announcement" role="status">{announcement}</span>
  </div>;
}

function PracticeMediaTitle({ title, time }) {
  const sourceTime = Number.isFinite(time)
    ? <> <span className="practice__time-separator" aria-hidden="true">·</span> <time dateTime={`PT${time / 1000}S`}>{timestamp(time)}</time></>
    : null;
  return <div className="practice__media-title">
    {title.type === "movie" ? <><strong>{title.title}</strong>{sourceTime}</> : <>
      <strong>{title.show}</strong>
      <span className="practice__episode-title">{episodeCode(title.season, title.episode)} · {title.title}{sourceTime}</span>
    </>}
  </div>;
}

function PracticeSession({ initialProgress, initialConjugations, loadDeck, loadConjugations, loading, onSaveError,
  dialogRef, title, game, reviewing, conjugating, vocabularyWords, renderToolbar }) {
  const [progress, setProgress] = useState(initialProgress);
  const [conjugationProgress, setConjugationProgress] = useState(initialConjugations);
  const [asOf, setAsOf] = useState(Date.now);
  const [{ count: combo, outcome, eventId }, setCombo] = useState({ count: 0, outcome: null, eventId: 0 });
  const [credits, setCredits] = useState([]);
  const successSound = useRef(null);
  const singleTitle = Boolean(title);
  const practice = usePracticeDeck(loadDeck, progress, singleTitle, game === "quiz", reviewing,
    { conjugating, conjugationProgress, loadConjugations });
  const { total, membership, reviewedWords } = practice.deck ?? {};
  const progressWords = reviewing || conjugating ? vocabularyWords : reviewedWords;
  const vocabularyProgress = useMemo(() => progressWords
    ? reviewedVocabularyProgress(progressWords, progress)
    : !reviewing && !conjugating && membership && deckPracticeStats(total, membership, progress, asOf),
  [progressWords, reviewing, conjugating, total, membership, progress, asOf]);

  function recordComboOutcome(outcome) {
    setCombo(previous => ({
      count: outcome === "correct" ? previous.count + 1 : 0,
      outcome,
      eventId: previous.eventId + 1,
    }));
  }

  const dismissCredit = useCallback(id => setCredits(previous => previous.filter(credit => credit.id !== id)), []);

  function updateVocabulary(presented) {
    practice.record(presented);
    setProgress(previous => {
      const next = new Map(previous);
      for (const [, word] of presented) next.set(word.id, word);
      return next;
    });
  }

  function saveAppearances(slots, now, conjugation = false) {
    void savePracticeAppearances(slots, now, conjugation, title?.id).then(presented => {
      if (!conjugation) updateVocabulary(presented);
    }).catch(onSaveError);
  }

  function saveTeaching(card) {
    void savePracticeTeaching(card).then(word => {
      if (word) updateVocabulary([[card, word]]);
    }).catch(onSaveError);
  }

  function saveOutcome(question, outcome) {
    const { id, card, phrase, word, titleId, conjugation } = question;
    const context = conjugation ? {} : phrase && { titleId: titleId ?? title?.id, cue: phrase.cue,
      meaning: phrase.targets[word][5]?.[0] ?? card.meaning };
    const at = Date.now();
    void savePracticeOutcome(id, { ...outcome, at, ...(context && { context }) }, Boolean(conjugation))
      .then(({ previous: before, word }) => {
        if (conjugation) setConjugationProgress(previous => new Map(previous).set(word.id, word));
        else updateVocabulary([[card, word]]);
        setAsOf(previous => Math.max(previous, at));
        const from = masteryAt(before, at);
        const to = masteryAt(word, at);
        if (outcome.correct || to !== from) {
          setCredits(previous => [...previous.filter(credit => credit.card.id !== card.id).slice(-2),
            { id, card, from, to }]);
        }
      }).catch(onSaveError);
  }

  function playSuccessSound() {
    const sound = successSound.current;
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  }

  const refreshProgress = useEffectEvent(async () => {
    const [latest, forms] = await Promise.all([readPracticeProgress(), readConjugationProgress()]);
    if (await practice.refreshedProgress(latest)) {
      setAsOf(Date.now());
      setProgress(latest);
      setConjugationProgress(forms);
    }
  });
  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : null;
    const refresh = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt > 5 * 60_000) {
        void refreshProgress().catch(onSaveError);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [onSaveError]);

  const unavailable = practice.error && <p role="alert">{practice.error}{" "}
    <button type="button" onClick={practice.retry}>Try again</button></p>;
  if (!practice.deck) return <>
    {renderToolbar()}
    {unavailable || loading}
  </>;
  const comboMilestone = combo > 0 && combo % 5 === 0;
  const Game = practiceGames[game];
  function renderCombo(chat) {
    const fox = <PracticeComboFox key={eventId} combo={combo} milestone={comboMilestone} outcome={outcome} />;
    return <span className="practice__combo">
      <span className="practice__combo-count">Combo{" "}
        <strong key={combo} data-combo-hit={combo > 0 || undefined} data-combo-milestone={comboMilestone || undefined}>
          ×{combo}
          {comboMilestone && <span className="practice__combo-sparks" aria-hidden="true"><span /><span /><span /></span>}
        </strong>
      </span>
      {chat ? <button type="button" className="practice-chat__toggle" ref={chat.button}
        aria-label={chat.open ? "Close chat with Yomiru" : "Ask Yomiru"} aria-expanded={chat.open}
        aria-controls={chat.open ? chat.id : undefined} onClick={chat.onToggle}>{fox}<span>Ask</span></button> : fox}
    </span>;
  }
  function renderProgress({ timeline, round, source, chatToggle } = {}) {
    return <>
      {renderToolbar({ sourceTitle: reviewing ? source?.title : title, time: source?.time, round,
        comboDisplay: reviewing ? null : renderCombo(chatToggle), progress: vocabularyProgress ?? null, timeline })}
      <div className="practice__credits" aria-live="polite" aria-relevant="additions"
        aria-label="Mastery feedback">
        {credits.map(credit => <MasteryCredit key={credit.id} credit={credit} onDismiss={dismissCredit} />)}
      </div>
      {unavailable}
    </>;
  }
  return <div className="practice__game">
    <audio ref={successSound} src={matchSuccessSound} preload="auto" />
    {game !== "quiz" && renderProgress()}
    <Game practice={practice} progress={progress} conjugationProgress={conjugationProgress} asOf={asOf} loading={loading}
      conjugating={conjugating} saveAppearances={saveAppearances} saveTeaching={saveTeaching}
      dialogRef={dialogRef} onComboOutcome={recordComboOutcome} playSuccessSound={playSuccessSound} saveOutcome={saveOutcome}
      singleTitle={singleTitle} episodeId={title?.id} reviewing={reviewing} renderProgress={renderProgress} />
  </div>;
}

function MasteryCredit({ credit: { id, card, from, to }, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4600);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  const written = card.written ?? card.kana;
  const changed = from !== to;
  const percent = value => value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%";
  return <div className="practice__credit">
    <div className="practice__credit-title">
      <span lang="ja"><strong>{written}</strong>{written !== card.kana && <small>{card.kana}</small>}</span>
      <span className="practice__credit-score">{changed && `${percent(from)} → `}{percent(to)}</span>
    </div>
    {card.meaning && <span className="practice__credit-meaning" lang="en">{card.meaning}</span>}
    <div className="practice__credit-track" data-changed={changed || undefined}
      role="progressbar" aria-label={`Mastery for ${written}`}
      aria-valuenow={Math.round(to)} aria-valuemin={0} aria-valuemax={100}
      style={{ "--credit-from": `${from}%`, "--credit-to": `${to}%` }}><span /></div>
  </div>;
}

export function VocabularyPractice({ loadDeck, loadReview, loadConjugations, onClose, error, onRetry, title,
  conjugating = false, vocabularyWords, unsupported = false }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const [initialProgress, setInitialProgress] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const saveFailed = useCallback(() => setStorageError(true), []);

  useLayoutEffect(() => {
    dialog.current.showModal();
    heading.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (unsupported) return;
    let active = true;
    void Promise.all([readPracticeProgress(), readConjugationProgress()])
      .then(progress => { if (active) setInitialProgress(progress); })
      .catch(() => { if (active) setStorageError(true); });
    return () => { active = false; };
  }, [unsupported]);
  const loading = error || storageError ? null : <PracticeLoading />;
  const game = title || unsupported ? "quiz" : defaultPracticeGame;
  const reviewing = !title && !unsupported && game === "quiz";
  const screenName = reviewing ? "Review" : "Practice";

  function renderToolbar({ sourceTitle = title, time, round, comboDisplay, progress, timeline } = {}) {
    return <header className="practice__toolbar">
      <div className="practice__toolbar-row">
        <button type="button" className="practice__back" onClick={() => dialog.current.close()}>
          <span aria-hidden="true">←</span> Library
        </button>
        <div className="practice__toolbar-title">
          {sourceTitle?.title || sourceTitle?.show ? <PracticeMediaTitle title={sourceTitle} time={time} />
            : <span className="practice__screen-name" aria-hidden="true">{screenName}</span>}
        </div>
        <div className="practice__toolbar-status">
          {round && <span className="practice__round-count">{round.number} of {round.total}</span>}
          {comboDisplay}
        </div>
      </div>
      {progress !== undefined && (progress?.total > 0 ? <VocabularyProgress progress={progress} hideLabel /> :
        <span className="vocabulary-progress__track" aria-hidden="true" />)}
      {timeline}
      {!unsupported && (storageError || error) && <div className="practice__notices">
        {storageError && <p role="alert">Practice progress couldn’t be saved in this browser.</p>}
        {error && <p role="alert">{error}{onRetry && <> <button type="button" onClick={onRetry}>Try again</button></>}</p>}
      </div>}
    </header>;
  }

  // Keep the last coherent board while the next vocabulary revision loads.
  return <dialog className="practice" ref={dialog} aria-labelledby="practice-title" onClose={onClose}
    onKeyDown={event => { if (event.key === "Escape") event.preventDefault(); }}>
    <h2 className="sr-only" id="practice-title" ref={heading} tabIndex={-1}>{screenName}</h2>
    <div className="practice__content" data-game={game} data-reviewing={reviewing || undefined}>
      {unsupported ? <>
        {renderToolbar({ sourceTitle: null })}
        <section className="practice__unavailable">
          <PracticeComboFox disappointed />
          <p role="alert">{error}</p>
          {title && <strong>{title.title}</strong>}
        </section>
      </> : initialProgress ? <PracticeSession initialProgress={initialProgress[0]} initialConjugations={initialProgress[1]}
        loadDeck={reviewing ? loadReview : loadDeck} loadConjugations={loadConjugations}
        loading={loading} onSaveError={saveFailed} dialogRef={dialog} title={title} game={game}
        reviewing={reviewing} conjugating={conjugating} vocabularyWords={vocabularyWords} renderToolbar={renderToolbar} />
        : <>{renderToolbar()}{loading}</>}
    </div>
  </dialog>;
}
