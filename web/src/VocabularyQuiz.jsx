import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { EpisodeScrubber } from "./EpisodeScrubber.jsx";
import { practiceTranslationRecentlyRevealed, savePracticeAppearances, savePracticeTranslationReveal }
  from "./vocabulary-practice-storage.mjs";
import { episodeCueTime, episodeQuestionFor, nextEpisodeQuestion, nextQuizQuestion,
  quizContextSpans, quizKeys, recordEpisodeAnswer } from "./vocabulary-quiz.mjs";
import { shufflePracticeItems } from "./vocabulary-practice.mjs";

const correctFeedbackMs = 350;
const incorrectFeedbackMs = 1800;
const tapVibrationMs = 35;

function ContextLine({ text, spans, script, renderWord }) {
  const characters = Array.from(text);
  let previousEnd = 0;
  const pieces = spans.map(({ meaning, [script]: [start, end] }, index) => {
    const before = characters.slice(previousEnd, start).join("");
    const word = characters.slice(start, end).join("");
    previousEnd = end;
    return <span key={start}>{before}{meaning ? renderWord(word, meaning, index) : <mark>{word}</mark>}</span>;
  });
  return <>{pieces}{characters.slice(previousEnd).join("")}</>;
}

function ContextPrompt({ example, cardId, onPeek, children }) {
  const [, kana, romaji] = example;
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const [opened, setOpened] = useState(null);
  const promptRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipId = useId();
  const peek = opened;
  const highlighted = hover ?? focus ?? peek?.index;
  const spans = quizContextSpans(example, cardId);

  useLayoutEffect(() => {
    if (!peek) return;
    const prompt = promptRef.current;
    const readingArea = prompt.parentElement;
    const tooltip = tooltipRef.current;
    function position() {
      const bounds = prompt.getBoundingClientRect();
      const region = readingArea.getBoundingClientRect();
      const trigger = peek.anchor.getBoundingClientRect();
      const center = trigger.left + trigger.width / 2 - bounds.left;
      const width = tooltip.offsetWidth;
      const left = Math.max(0, Math.min(center - width / 2, bounds.width - width));
      const arrow = Math.max(8, Math.min(center - left, width - 8));
      const height = tooltip.offsetHeight;
      const gap = 9;
      const anchor = bounds.bottom + gap + height <= region.bottom ? bounds : trigger;
      const above = anchor.bottom + gap + height > region.bottom;
      const top = above ? Math.max(region.top + 4, trigger.top - gap - height) : anchor.bottom + gap;
      tooltip.style.setProperty("--peek-left", `${left}px`);
      tooltip.style.setProperty("--peek-arrow", `${arrow}px`);
      tooltip.style.setProperty("--peek-top", `${top - bounds.top}px`);
      tooltip.toggleAttribute("data-above", above);
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(prompt);
    observer.observe(readingArea);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [peek]);

  useEffect(() => {
    if (!peek) return;
    function dismissOnOutside(event) {
      if (!tooltipRef.current?.contains(event.target) && !event.target.closest?.(".practice__peek-word")) {
        setOpened(null);
      }
    }
    function dismissOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpened(null);
      }
    }
    document.addEventListener("pointerdown", dismissOnOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [peek]);

  function renderWord(text, meaning, index) {
    return <button type="button" className="practice__peek-word"
      data-highlighted={highlighted === index || undefined}
      aria-expanded={peek?.index === index}
      aria-controls={peek?.index === index ? tooltipId : undefined}
      onPointerEnter={event => { if (event.pointerType !== "touch") setHover(index); }}
      onPointerLeave={() => setHover(value => value === index ? null : value)}
      onFocus={() => setFocus(index)} onBlur={() => setFocus(value => value === index ? null : value)}
      onClick={event => {
        const anchor = event.currentTarget;
        if (peek?.anchor === anchor) setOpened(null);
        else if (onPeek()) setOpened({ anchor, index, meaning });
      }}>{text}</button>;
  }

  return <div className="practice__context" ref={promptRef}>
    <div className="practice__prompt" id="practice-prompt" data-context="true"
      style={{ "--context-length": Array.from(kana).length }}>
      <strong lang="ja"><ContextLine text={kana} spans={spans} script="kana" renderWord={renderWord} /></strong>
      <span lang="ja-Latn"><ContextLine text={romaji} spans={spans} script="romaji" renderWord={renderWord} /></span>
    </div>
    {children}
    {peek && <div className="practice__peek-tooltip" id={tooltipId} ref={tooltipRef} role="tooltip" lang="en">
      {peek.meaning}
    </div>}
    <span className="practice__announcement" role="status">{peek?.meaning}</span>
  </div>;
}

export function VocabularyQuiz({
  practice, progress, loading, onSaveError, onComboOutcome, playSuccessSound, saveOutcome, singleTitle, dialogRef,
  renderCombo, renderProgress,
}) {
  const [question, setQuestion] = useState(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [needsMoreCards, setNeedsMoreCards] = useState(false);
  const [hasDelayedReviews, setHasDelayedReviews] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [seeking, setSeeking] = useState(false);
  const [seekError, setSeekError] = useState("");
  const game = useRef({ question: null, peeked: false, turn: 0, lastPlayed: new Map(), timer: null,
    seen: new Set(), retries: new Map(), forward: 0, seeking: false });
  const board = useRef(null);
  const focused = useRef(false);
  const cards = practice.deck?.cards;
  const questionId = question?.id;
  const timeline = singleTitle && practice.deck?.timeline;

  function presentQuestion(next, now) {
    const current = game.current;
    current.question = { ...next, id: crypto.randomUUID() };
    current.peeked = false;
    void savePracticeAppearances([current.question], now).catch(onSaveError);
    setNeedsMoreCards(false);
    setQuestion(current.question);
  }

  const showQuestion = useEffectEvent(() => {
    const current = game.current;
    if (current.question || current.seeking || !cards) return;
    const now = Date.now();
    const next = singleTitle ? nextEpisodeQuestion(practice.deck, current, practiceTranslationRecentlyRevealed)
      : nextQuizQuestion(cards, progress, current.lastPlayed, current.turn, now, practiceTranslationRecentlyRevealed);
    if (!next) {
      if (singleTitle) {
        setQuestion(null);
        setHasDelayedReviews(current.retries.size > 0 || practice.deck.fresh.some(card =>
          !current.seen.has(card.id) && card.examples?.length
          && card.examples.every(example => practiceTranslationRecentlyRevealed(example, now))));
      }
      setNeedsMoreCards(true);
      if (!practice.error) void practice.refill(true);
      return;
    }
    presentQuestion(next, now);
  });
  useEffect(() => { showQuestion(); }, [cards, completedTurns, seeking]);

  useEffect(() => {
    const current = game.current;
    return () => clearTimeout(current.timer);
  }, []);
  useLayoutEffect(() => {
    if (!questionId) return;
    const dialog = dialogRef.current;
    if (dialog.scrollTop) dialog.scrollTop = 0;
    if (!focused.current || document.activeElement === document.body || board.current.contains(document.activeElement)) {
      focused.current = true;
      board.current.focus({ preventScroll: true });
    }
  }, [dialogRef, questionId]);

  function advance() {
    const current = game.current;
    if (board.current?.contains(document.activeElement)) board.current.focus({ preventScroll: true });
    current.question = null;
    current.timer = null;
    setCompletedTurns(current.turn);
  }

  function answer(index, touch = false) {
    const current = game.current;
    const shown = current.question;
    const choice = shown?.choices[index];
    if (!choice || shown.answered || current.seeking) return;

    const { card, choices, example } = shown;
    const correct = choice.id === card.id;
    const exposed = shown.translation || practiceTranslationRecentlyRevealed(example);
    const clean = correct && !current.peeked && !exposed;
    const lastTurn = current.lastPlayed.get(card.id)?.turn ?? -Infinity;
    if (!exposed) saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2 });
    current.lastPlayed.set(card.id, { turn: ++current.turn, correct, cue: example[0] });
    if (singleTitle) recordEpisodeAnswer(current, shown, clean, progress, Date.now());
    if (!shown.review) practice.onAttempt(card);
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (exposed) onComboOutcome("reset");
    else if (!correct) onComboOutcome("miss");
    else if (clean) onComboOutcome("correct");
    if (correct && !exposed) playSuccessSound();
    setAnnouncement(correct ? `Correct. ${card.kana} means ${card.meaning}.`
        : `Incorrect. The correct meaning of ${card.kana} is ${card.meaning}.`);
    current.question = { ...shown, answered: choice.id };
    setQuestion(current.question);
    current.timer = setTimeout(advance, correct ? correctFeedbackMs : incorrectFeedbackMs);
  }

  async function toggleTranslation() {
    const current = game.current;
    const shown = current.question;
    if (!shown || current.seeking) return;

    function update(changes) {
      current.question = { ...current.question, ...changes };
      setQuestion(current.question);
    }
    if (shown.showTranslation || shown.translation) {
      update({ showTranslation: !shown.showTranslation });
      return;
    }
    update({ showTranslation: true, loadingTranslation: true, translationError: "" });
    if (shown.loadingTranslation) return;
    try {
      const translation = await practice.loadTranslation(shown.example[0]);
      if (current.question?.id !== shown.id) return;
      if (!translation) {
        update({ showTranslation: false, loadingTranslation: false,
          translationError: current.question.showTranslation ? "Translation unavailable." : "" });
        return;
      }
      if (!current.question.showTranslation) {
        update({ loadingTranslation: false });
        return;
      }
      try { savePracticeTranslationReveal(shown.example); }
      catch { onSaveError(); }
      update({ loadingTranslation: false, translation });
    } catch {
      if (current.question?.id === shown.id) {
        update({ showTranslation: false, loadingTranslation: false,
          translationError: current.question.showTranslation ? "Couldn’t show the translation. Try again." : "" });
      }
    }
  }

  function peekAtWord() {
    const current = game.current;
    if (!current.question || current.seeking) return false;
    current.peeked = true;
    onComboOutcome("reset");
    return true;
  }

  function handleKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    const index = quizKeys.indexOf(event.key);
    if (index === -1) return;
    event.preventDefault();
    answer(index);
  }

  async function jump([time, id, after], focusQuiz = false) {
    const current = game.current;
    if (current.seeking || current.question?.answered || current.question?.card.id === id) return;
    const focusedControl = document.activeElement;
    current.seeking = true;
    setSeeking(true);
    setSeekError("");
    try {
      const next = await practice.jump(after, (cards, fresh) => {
        const card = fresh.find(card => card.id === id);
        if (episodeCueTime(timeline, card?.examples?.[0]) !== time) return;
        return episodeQuestionFor(card, shufflePracticeItems(cards), practiceTranslationRecentlyRevealed);
      });
      if (!next) return;
      current.seen.clear();
      current.forward = 0;
      setAnnouncement("");
      presentQuestion(next, Date.now());
      if (focusQuiz && document.activeElement === focusedControl) board.current?.focus({ preventScroll: true });
    } catch {
      setSeekError("Couldn’t jump to that subtitle. Try again.");
    } finally {
      current.seeking = false;
      setSeeking(false);
    }
  }

  const shown = question;
  const waiting = !shown || needsMoreCards;
  const shortDeck = needsMoreCards && !practice.deck?.next;
  const emptyMessage = singleTitle
    ? (hasDelayedReviews ? "Practice complete. Some words are waiting for delayed review."
      : completedTurns ? "Practice complete." : "There aren’t enough subtitle examples for this quiz.")
    : "Choose more titles to practice with subtitle examples and four distinct meanings.";
  return <>{renderCombo(singleTitle && { pressed: Boolean(shown?.showTranslation),
    onToggle: shown && !seeking ? toggleTranslation : null, onKeyDown: handleKey })}
  <div className="practice__quiz-session">
    {renderProgress(timeline && <EpisodeScrubber timeline={timeline}
      time={episodeCueTime(timeline, shown?.example)}
      blocked={Boolean(seeking || (shown?.answered && !waiting))} onJump={jump} />)}
    {seekError && <p role="alert">{seekError}</p>}
    {seeking && <span className="practice__announcement" role="status">Jumping to subtitle…</span>}
    {waiting && !practice.error && (shortDeck
      ? <p role="status">{emptyMessage}</p> : loading)}
    {shown && <div className="practice__quiz" ref={board} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__quiz-prompt" key={shown.id}>
        <ContextPrompt example={shown.example} cardId={shown.card.id} onPeek={peekAtWord}>
          {shown.showTranslation && <p className="practice__quiz-translation" lang="en" role="status">
            {shown.loadingTranslation ? "Loading translation…" : shown.translation}
          </p>}
          {shown.translationError && <p className="practice__quiz-translation" role="status">{shown.translationError}</p>}
        </ContextPrompt>
      </div>
      <div className="practice__quiz-response">
        <div className="practice__quiz-choices" role="group" aria-label="Choose the English meaning"
          aria-describedby="practice-prompt">
          {shown.choices.map((choice, index) => {
            const feedback = !shown.answered ? undefined : choice.id === shown.card.id ? "correct"
              : choice.id === shown.answered ? "incorrect" : undefined;
            return <button type="button" className="practice__quiz-choice" key={index}
              aria-keyshortcuts={shown.answered || seeking ? undefined : quizKeys[index]}
              aria-disabled={shown.answered || seeking || undefined} data-quiz-feedback={feedback}
              data-chosen={choice.id === shown.answered ? "true" : undefined}
              onClick={({ nativeEvent }) => {
                const touch = nativeEvent.pointerType === "touch" || nativeEvent.sourceCapabilities?.firesTouchEvents === true;
                answer(index, touch);
              }}>
              <span className="practice__quiz-choice-face">
                <kbd aria-hidden="true">{quizKeys[index]}</kbd>
                <span lang="en">{choice.meaning}</span>
                {feedback && <span className="practice__quiz-feedback" aria-hidden="true">
                  {feedback === "correct" ? "✓" : "×"}
                </span>}
              </span>
            </button>;
          })}
        </div>
      </div>
    </div>}
    <span className="practice__announcement" aria-live="polite">
      <span lang="ja">{shown?.example?.[1] ?? shown?.card.kana}</span>{" "}
      <span lang="ja-Latn">{shown?.example?.[2] ?? shown?.card.romaji}</span>
    </span>
    <span className="practice__announcement" role="status">{announcement}</span>
  </div></>;
}
