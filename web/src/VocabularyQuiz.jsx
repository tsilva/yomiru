import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { savePracticeAppearances } from "./vocabulary-practice-storage.mjs";
import { nextEpisodeQuestion, nextQuizQuestion, quizContextSpans, quizKeys, recordEpisodeAnswer } from "./vocabulary-quiz.mjs";

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

function ContextPrompt({ example, cardId, answered, onPeek }) {
  const [, kana, romaji] = example;
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const [opened, setOpened] = useState(null);
  const promptRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipId = useId();
  const peek = answered ? null : opened;
  const highlighted = answered ? null : hover ?? focus ?? peek?.index;
  const spans = quizContextSpans(example, cardId);

  useLayoutEffect(() => {
    if (!peek) return;
    const prompt = promptRef.current;
    const scrollRegion = prompt.parentElement;
    const tooltip = tooltipRef.current;
    function position() {
      const bounds = prompt.getBoundingClientRect();
      const region = scrollRegion.getBoundingClientRect();
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
    observer.observe(scrollRegion);
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
    return <button type="button" className="practice__peek-word" disabled={answered}
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

  return <div className="practice__context" ref={promptRef}
    data-has-peeks={spans.some(({ meaning }) => meaning) || undefined}>
    <div className="practice__prompt" id="practice-prompt" data-context="true"
      style={{ "--context-length": Array.from(kana).length }}>
      <strong lang="ja"><ContextLine text={kana} spans={spans} script="kana" renderWord={renderWord} /></strong>
      <span lang="ja-Latn"><ContextLine text={romaji} spans={spans} script="romaji" renderWord={renderWord} /></span>
    </div>
    {peek && <div className="practice__peek-tooltip" id={tooltipId} ref={tooltipRef} role="tooltip" lang="en">
      {peek.meaning}
    </div>}
    <span className="practice__announcement" role="status">{peek?.meaning}</span>
  </div>;
}

export function VocabularyQuiz({
  practice, progress, loading, onSaveError, onComboOutcome, playSuccessSound, saveOutcome, singleTitle, dialogRef,
}) {
  const [question, setQuestion] = useState(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [needsMoreCards, setNeedsMoreCards] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const game = useRef({ question: null, peeked: false, turn: 0, lastPlayed: new Map(), timer: null,
    seen: new Set(), retries: new Map(), forward: 0 });
  const board = useRef(null);
  const focused = useRef(false);
  const cards = practice.deck?.cards;
  const questionId = question?.id;

  const showQuestion = useEffectEvent(() => {
    const current = game.current;
    if (current.question || !cards) return;
    const now = Date.now();
    const next = singleTitle ? nextEpisodeQuestion(practice.deck, current)
      : nextQuizQuestion(cards, progress, current.lastPlayed, current.turn, now);
    if (!next) {
      setNeedsMoreCards(true);
      if (!practice.error) void practice.refill(true);
      return;
    }
    current.question = { ...next, id: crypto.randomUUID() };
    current.peeked = false;
    void savePracticeAppearances([current.question], now).catch(onSaveError);
    setNeedsMoreCards(false);
    setQuestion(current.question);
  });
  useEffect(() => { showQuestion(); }, [cards, completedTurns]);

  useEffect(() => {
    const current = game.current;
    return () => clearTimeout(current.timer);
  }, []);
  useLayoutEffect(() => {
    if (!questionId) return;
    for (const tile of board.current.querySelectorAll(".practice__tile")) tile.scrollTop = 0;
    const dialog = dialogRef.current;
    if (dialog.scrollTop && window.matchMedia("(max-width: 640px)").matches) dialog.scrollTop = 0;
    if (!focused.current || board.current.contains(document.activeElement)) {
      focused.current = true;
      board.current.focus({ preventScroll: true });
    }
  }, [dialogRef, questionId]);

  function answer(index, touch = false) {
    const current = game.current;
    const shown = current.question;
    const choice = shown?.choices[index];
    if (!choice || current.timer !== null) return;

    const { card, choices } = shown;
    const correct = choice.id === card.id;
    const clean = correct && !current.peeked;
    const lastTurn = current.lastPlayed.get(card.id)?.turn ?? -Infinity;
    saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2 });
    current.lastPlayed.set(card.id, { turn: ++current.turn, correct, cue: shown.example?.[0] });
    if (singleTitle) recordEpisodeAnswer(current, shown, clean, progress, Date.now());
    if (!shown.review) practice.onAttempt(card);
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (correct) playSuccessSound();
    if (!correct) onComboOutcome("miss");
    else if (clean) onComboOutcome("correct");
    if (document.activeElement?.matches(".practice__peek-word")) board.current.focus({ preventScroll: true });
    setAnnouncement(correct ? `Correct. ${card.kana} means ${card.meaning}.`
      : `Incorrect. The correct meaning of ${card.kana} is ${card.meaning}.`);
    setQuestion({ ...shown, answered: choice.id });
    current.timer = setTimeout(() => {
      current.question = null;
      current.timer = null;
      setCompletedTurns(current.turn);
    }, correct ? correctFeedbackMs : incorrectFeedbackMs);
  }

  function peekAtWord() {
    const current = game.current;
    if (!current.question || current.timer !== null) return false;
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

  const shown = question;
  const waiting = !shown || needsMoreCards;
  const shortDeck = needsMoreCards && !practice.deck?.next;
  const emptyMessage = singleTitle
    ? (completedTurns ? "Practice complete." : "There aren’t enough subtitle examples for this quiz.")
    : "Choose more titles to practice with subtitle examples and four distinct meanings.";
  return <>
    {waiting && !practice.error && (shortDeck
      ? <p role="status">{emptyMessage}</p> : loading)}
    {shown && <div className="practice__quiz" ref={board} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__quiz-prompt" key={shown.id}>
        <ContextPrompt example={shown.example} cardId={shown.card.id}
          answered={Boolean(shown.answered)} onPeek={peekAtWord} />
      </div>
      <div className="practice__quiz-choices" role="group" aria-label="Choose the English meaning"
        aria-describedby="practice-prompt">
        {shown.choices.map((choice, index) => {
          const feedback = !shown.answered ? undefined : choice.id === shown.card.id ? "correct"
            : choice.id === shown.answered ? "incorrect" : undefined;
          return <button type="button" className="practice__tile" key={index}
            aria-keyshortcuts={shown.answered ? undefined : quizKeys[index]}
            aria-disabled={shown.answered ? true : undefined} data-quiz-feedback={feedback}
            onClick={({ nativeEvent }) => {
              const touch = nativeEvent.pointerType === "touch" || nativeEvent.sourceCapabilities?.firesTouchEvents === true;
              answer(index, touch);
            }}>
            <kbd aria-hidden="true">{quizKeys[index]}</kbd>
            <span lang="en">{choice.meaning}</span>
            {feedback && <span className="practice__quiz-feedback" aria-hidden="true">
              {feedback === "correct" ? "✓" : "×"}
            </span>}
          </button>;
        })}
      </div>
    </div>}
    <span className="practice__announcement" aria-live="polite">
      <span lang="ja">{shown?.example?.[1] ?? shown?.card.kana}</span>{" "}
      <span lang="ja-Latn">{shown?.example?.[2] ?? shown?.card.romaji}</span>
    </span>
    <span className="practice__announcement" role="status">{announcement}</span>
  </>;
}
