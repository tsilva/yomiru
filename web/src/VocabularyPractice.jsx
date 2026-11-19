import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nextPracticeCards, practiceCards, selectionPracticeStats } from "./vocabulary-practice.mjs";
import { readPracticeProgress, savePracticeAppearances, savePracticeOutcome } from "./vocabulary-practice-storage.mjs";
import matchSuccessSound from "./match-success.wav";
import "./vocabulary-practice.css";

const keys = { ja: ["1", "2", "3", "4"], en: ["5", "6", "7", "8"] };
const correctFeedbackMs = 225;
const tapVibrationMs = 35;

function practiceCapacity() {
  if (window.matchMedia("(max-width: 640px) and (min-height: 720px)").matches) return 6;
  if (window.matchMedia("(max-width: 640px) and (min-height: 640px)").matches) return 5;
  return keys.ja.length;
}

function shuffle(slots) {
  const result = [...slots];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
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
    <img src="/assets/fox.png" width="208" height="208" alt="" />
    <span>Loading practice…</span>
    <span className="practice__loading-dots" aria-hidden="true"><span /><span /><span /></span>
  </div>;
}

function PracticeRow({ language, slots, selected, onPick, onFeedbackEnd }) {
  const label = language === "ja" ? "Japanese" : "English";
  const shortcuts = slots.length === keys.ja.length ? keys[language] : [];
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
        {slot && <button type="button" className="practice__tile" aria-keyshortcuts={feedback ? undefined : shortcuts[index]}
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

function PracticeBoard({ initialProgress, cards, loading, onSaveError }) {
  const [progress, setProgress] = useState(initialProgress);
  const [asOf, setAsOf] = useState(Date.now);
  const [board, setBoard] = useState(null);
  const [selected, setSelected] = useState(null);
  const [combo, setCombo] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const playing = useRef({ board: null, selected: null, turn: 0, lastPlayed: new Map(), timer: null });
  const boardRef = useRef(null);
  const successSound = useRef(null);
  const focused = useRef(false);
  const pool = cards ?? board?.pool;
  const cardsById = useMemo(() => new Map(pool?.map(card => [card.id, card])), [pool]);
  const stats = useMemo(() => pool && selectionPracticeStats(pool, progress, asOf, cardsById),
    [pool, progress, asOf, cardsById]);

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
    void savePracticeAppearances(slots, now).catch(onSaveError);
    const empty = Array(capacity).fill(null);
    let size = Math.max(base?.size ?? 0, active.length + slots.length);
    if (fresh && size === 1 && lastPlayed.size) {
      // A rebuild can temporarily leave one pair while the most recent miss cools down.
      size = nextPracticeCards(pool, progress, [], new Map(), 0, 2, now, true).length;
    }
    return { pool, size,
      ja: fillVacancies(base?.ja ?? empty, slots), en: fillVacancies(base?.en ?? empty, shuffle(slots)) };
  }

  const startBoard = useEffectEvent(() => {
    const current = playing.current;
    const pool = cards ?? current.board?.pool;
    // Keep the current positions intact while tile feedback is visible.
    if (!pool || hasTileFeedback(current.board)) return;
    const capacity = practiceCapacity();
    if (!current.board || current.board.ja.length !== capacity
      || (current.board.size < 2 && current.board.pool !== pool)) {
      current.selected = null;
      setSelected(null);
      focused.current = false;
      updateBoard(addCards(pool, null, capacity));
    }
  });
  useEffect(() => {
    const onResize = () => startBoard();
    startBoard();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cards]);
  useEffect(() => {
    const current = playing.current;
    return () => { clearTimeout(current.timer); };
  }, []);
  useLayoutEffect(() => {
    if (board?.size >= 2 && !focused.current) {
      focused.current = true;
      boardRef.current.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [board]);

  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : null;
    const refresh = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt !== null && Date.now() - hiddenAt > 5 * 60_000) {
        setAsOf(Date.now());
        void readPracticeProgress().then(setProgress).catch(onSaveError);
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [onSaveError]);

  function finishFeedback(language, id) {
    const current = playing.current;
    const row = current.board[language];
    const tile = row.find(slot => slot?.id === id);
    if (!tile?.feedback) return;
    const matched = tile.feedback === "correct";
    const next = matched
      ? { ...current.board, ja: current.board.ja.map(slot => slot?.id === id ? null : slot),
        en: current.board.en.map(slot => slot?.id === id ? null : slot) }
      : { ...current.board, [language]: row.map(slot => slot === tile ? { ...tile, feedback: undefined } : slot) };
    const pool = cards ?? next.pool;
    const capacity = practiceCapacity();
    const rebuild = pool !== next.pool || capacity !== next.ja.length;
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
    const sound = successSound.current;
    if (correct && sound) {
      sound.currentTime = 0;
      void sound.play().catch(() => {});
    }
    const matchingRow = current.board[language].filter(item => item && !item.feedback && item.refill === entry.refill);
    // The newest single refill gives its answer away. Older refills are practice evidence only.
    const choices = !entry.refill ? matchingRow.length
      : entry.enteredAt === current.turn ? 1 : Math.min(2, matchingRow.length);
    const last = current.lastPlayed.get(entry.card.id)?.turn ?? -Infinity;
    const spaced = current.turn - last >= Math.min(2, current.board.size - 1);
    if (!entry.missed) {
      void savePracticeOutcome(entry.id, { correct, choices, spaced, at: Date.now(), sessionStartedAt: asOf })
        .then(word => setProgress(previous => new Map(previous).set(word.id, word))).catch(onSaveError);
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
      if (!entry.missed) setCombo(previous => previous + 1);
      setAnnouncement(`${entry.card.kana} matched.`);
      current.timer = setTimeout(() => { current.timer = null; }, correctFeedbackMs);
    } else {
      setCombo(0);
      setAnnouncement("Those tiles didn’t match. Try again when they reset.");
    }
  }

  function handleKey(event) {
    if (playing.current.board?.ja.length !== keys.ja.length) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    const key = event.key;
    for (const language of ["ja", "en"]) {
      const index = keys[language].indexOf(key);
      if (index === -1) continue;
      event.preventDefault();
      pick(language, index);
      break;
    }
  }

  if (!board) return loading;
  const { mastery, mastered, total } = stats;
  const percentage = mastery.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const comboMilestone = combo > 0 && combo % 5 === 0;
  return <div className="practice__game" onKeyDown={handleKey}>
    <audio ref={successSound} src={matchSuccessSound} preload="auto" />
    <div className="practice__progress">
      <div className="practice__mastery">
        <label htmlFor="practice-mastery">Mastery <strong>{percentage}%</strong></label>
        <span className="practice__word-count">
          <span className="practice__word-count-divider" aria-hidden="true">·</span>
          <span>
            <strong>{mastered.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong>{" "}
            {total === 1 ? "word" : "words"} mastered
          </span>
        </span>
      </div>
      <span className="practice__combo">Combo{" "}
        <strong key={combo} data-combo-hit={combo > 0 || undefined} data-combo-milestone={comboMilestone || undefined}>
          ×{combo}
          {comboMilestone && <span className="practice__combo-sparks" aria-hidden="true"><span /><span /><span /></span>}
        </strong>
      </span>
      <progress id="practice-mastery" value={mastery} max="100" aria-valuetext={`${percentage}%`} />
    </div>
    {board.size < 2 ? <p role="status">Choose more titles to practice with distinct word pairs.</p> : (
      <div className="practice__board" ref={boardRef} tabIndex={-1} aria-label="Vocabulary matching board"
        style={{ "--practice-rows": board.ja.length }}>
        <PracticeRow language="ja" slots={board.ja} selected={selected} onPick={pick} onFeedbackEnd={finishFeedback} />
        <PracticeRow language="en" slots={board.en} selected={selected} onPick={pick} onFeedbackEnd={finishFeedback} />
      </div>
    )}
    <span className="practice__announcement" role="status">{announcement}</span>
  </div>;
}

export function VocabularyPractice({ words, onClose, error, onRetry }) {
  const dialog = useRef(null);
  const [initialProgress, setInitialProgress] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const saveFailed = useCallback(() => setStorageError(true), []);
  const cards = useMemo(() => words ? practiceCards(words) : null, [words]);
  const [initialCards] = useState(cards);

  useLayoutEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    let active = true;
    void readPracticeProgress().then(progress => { if (active) setInitialProgress(progress); })
      .catch(() => { if (active) setStorageError(true); });
    return () => { active = false; };
  }, []);
  const loading = error || storageError ? null : <PracticeLoading />;
  // Keep the last coherent board while the next vocabulary revision loads.
  return <dialog className="practice" ref={dialog} aria-labelledby="practice-title" onClose={onClose}>
    <div className="practice__content">
      <button type="button" className="practice__back" onClick={() => dialog.current.close()}>
        <span aria-hidden="true">←</span> Library
      </button>
      <h2 id="practice-title">Vocabulary practice</h2>
      {storageError && <p role="alert">Vocabulary progress couldn’t be saved in this browser.</p>}
      {error && <p role="alert">{error} <button type="button" onClick={onRetry}>Try again</button></p>}
      {initialProgress ? <PracticeBoard initialProgress={initialProgress} cards={cards ?? initialCards}
        loading={loading} onSaveError={saveFailed} /> : loading}
    </div>
  </dialog>;
}
