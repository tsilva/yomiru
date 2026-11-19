import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { savePracticeAppearances } from "./vocabulary-practice-storage.mjs";
import { nextQuizQuestion, quizKeys } from "./vocabulary-quiz.mjs";

const correctFeedbackMs = 350;
const incorrectFeedbackMs = 1800;
const tapVibrationMs = 35;

export function VocabularyQuiz({ practice, progress, loading, onSaveError, setCombo, playSuccessSound, saveOutcome }) {
  const [question, setQuestion] = useState(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [needsMoreCards, setNeedsMoreCards] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const game = useRef({ question: null, turn: 0, lastPlayed: new Map(), timer: null });
  const board = useRef(null);
  const focused = useRef(false);
  const cards = practice.deck?.cards;

  const showQuestion = useEffectEvent(() => {
    const current = game.current;
    if (current.question || !cards) return;
    const now = Date.now();
    const next = nextQuizQuestion(cards, progress, current.lastPlayed, current.turn, now);
    if (!next) {
      setNeedsMoreCards(true);
      if (!practice.error) void practice.refill(true);
      return;
    }
    current.question = { ...next, id: crypto.randomUUID() };
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
    if (question && !focused.current) {
      focused.current = true;
      board.current.focus({ preventScroll: true });
    }
  }, [question]);

  function answer(index, touch = false) {
    const current = game.current;
    const shown = current.question;
    const choice = shown?.choices[index];
    if (!choice || current.timer !== null) return;

    const { card, choices } = shown;
    const correct = choice.id === card.id;
    const lastTurn = current.lastPlayed.get(card.id)?.turn ?? -Infinity;
    saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2 });
    current.lastPlayed.set(card.id, { turn: ++current.turn, correct });
    practice.onAttempt(card);
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (correct) playSuccessSound();
    setCombo(previous => correct ? previous + 1 : 0);
    setAnnouncement(correct ? `Correct. ${card.kana} means ${card.meaning}.`
      : `Incorrect. The correct meaning of ${card.kana} is ${card.meaning}.`);
    setQuestion({ ...shown, answered: choice.id });
    current.timer = setTimeout(() => {
      current.question = null;
      current.timer = null;
      setCompletedTurns(current.turn);
    }, correct ? correctFeedbackMs : incorrectFeedbackMs);
  }

  function handleKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    const index = quizKeys.indexOf(event.key);
    if (index === -1) return;
    event.preventDefault();
    answer(index);
  }

  // Retain the answer buttons across questions so keyboard focus stays in place.
  const shown = question;
  const waiting = !shown || needsMoreCards;
  const shortDeck = needsMoreCards && !practice.deck?.next;
  return <>
    {waiting && !practice.error && (shortDeck
      ? <p role="status">Choose more titles to practice with four distinct meanings.</p> : loading)}
    {shown && <div className="practice__quiz" ref={board} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__prompt" id="practice-prompt" aria-live="polite">
        <strong lang="ja">{shown.card.kana}</strong>
        <span lang="ja-Latn">{shown.card.romaji}</span>
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
    <span className="practice__announcement" role="status">{announcement}</span>
  </>;
}
