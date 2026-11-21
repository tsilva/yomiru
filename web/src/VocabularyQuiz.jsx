import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { EpisodeTimeline } from "./EpisodeTimeline.jsx";
import { masteryAt } from "./vocabulary-practice.mjs";
import { savePracticeAppearances } from "./vocabulary-practice-storage.mjs";
import { nextPhraseQuestion, quizContextSpans, quizKeys } from "./vocabulary-quiz.mjs";

const correctFeedbackMs = 350;
const incorrectFeedbackMs = 500;
const tapVibrationMs = 35;

function ContextLine({ text, spans, script, renderWord }) {
  const characters = Array.from(text);
  let previousEnd = 0;
  const pieces = spans.map(({ id, [script]: [start, end] }, index) => {
    const before = characters.slice(previousEnd, start).join("");
    const word = characters.slice(start, end).join("");
    previousEnd = end;
    return <span key={start}>{before}{id ? renderWord(word, index, script) : <mark>{word}</mark>}</span>;
  });
  return <>{pieces}{characters.slice(previousEnd).join("")}</>;
}

function ContextPrompt({ example, cardId, progress, asOf, onPeek, children }) {
  const [, kana, romaji] = example;
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null);
  const [peek, setPeek] = useState(null);
  const promptRef = useRef(null);
  const romajiAnchorRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipId = useId();
  const highlighted = hover ?? focus ?? peek?.index;
  const spans = quizContextSpans(example, cardId);
  const word = spans[peek?.index];
  const record = word && progress.get(word.id);
  const mastery = record
    ? `Mastery ${(masteryAt(record, asOf) / 100).toLocaleString(undefined, { style: "percent" })}`
    : "Not practiced";
  const details = word && <>
    <span className="practice__peek-readings">
      {word.written && /\p{Script=Han}/u.test(word.written) &&
        <><strong lang="ja">{word.written}</strong>{" "}</>}
      <span lang="ja">{Array.from(kana).slice(...word.kana).join("")}</span>{" "}
      <span lang="ja-Latn">{Array.from(romaji).slice(...word.romaji).join("")}</span>
    </span>{" "}
    <span lang="en">{word.meaning}</span>{" "}
    <small lang="en">{mastery}</small>
  </>;

  useLayoutEffect(() => {
    if (!peek) return;
    const prompt = promptRef.current;
    const readingArea = prompt.parentElement;
    const tooltip = tooltipRef.current;
    const romajiAnchor = romajiAnchorRef.current;
    function position() {
      const bounds = prompt.getBoundingClientRect();
      const region = readingArea.getBoundingClientRect();
      const trigger = romajiAnchor.getBoundingClientRect();
      const center = trigger.left + trigger.width / 2 - bounds.left;
      const width = tooltip.offsetWidth;
      const left = Math.max(0, Math.min(center - width / 2, bounds.width - width));
      const arrow = Math.max(8, Math.min(center - left, width - 8));
      const height = tooltip.offsetHeight;
      const gap = 9;
      const above = bounds.bottom + gap + height > region.bottom;
      const aboveAnchor = bounds.top - gap - height >= region.top ? bounds : trigger;
      const top = above ? Math.max(region.top, aboveAnchor.top - gap - height) : bounds.bottom + gap;
      tooltip.style.setProperty("--peek-left", `${left}px`);
      tooltip.style.setProperty("--peek-arrow", `${arrow}px`);
      tooltip.style.setProperty("--peek-top", `${top - bounds.top}px`);
      tooltip.toggleAttribute("data-above", above);
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(prompt);
    observer.observe(readingArea);
    observer.observe(romajiAnchor);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [peek]);

  useEffect(() => {
    if (!peek) return;
    function dismissOnOutside(event) {
      if (!tooltipRef.current?.contains(event.target) && !event.target.closest?.(".practice__peek-word")) {
        setPeek(null);
      }
    }
    function dismissOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPeek(null);
      }
    }
    document.addEventListener("pointerdown", dismissOnOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [peek]);

  function renderWord(text, index, script) {
    return <button type="button" className="practice__peek-word"
      ref={script === "romaji" && peek?.index === index ? romajiAnchorRef : undefined}
      data-highlighted={highlighted === index || undefined}
      aria-expanded={peek?.index === index}
      aria-controls={peek?.index === index ? tooltipId : undefined}
      onPointerEnter={event => { if (event.pointerType !== "touch") setHover(index); }}
      onPointerLeave={() => setHover(value => value === index ? null : value)}
      onFocus={() => setFocus(index)} onBlur={() => setFocus(value => value === index ? null : value)}
      onClick={() => {
        if (peek?.index === index && peek.script === script) setPeek(null);
        else if (onPeek()) setPeek({ index, script });
      }}>{text}</button>;
  }

  return <div className="practice__context" ref={promptRef}>
    <div className="practice__prompt" id="practice-prompt" data-context="true"
      style={{ "--context-length": Array.from(kana).length }}>
      <strong lang="ja"><ContextLine text={kana} spans={spans} script="kana" renderWord={renderWord} /></strong>
      <span lang="ja-Latn"><ContextLine text={romaji} spans={spans} script="romaji" renderWord={renderWord} /></span>
    </div>
    {children}
    {peek && <div className="practice__peek-tooltip" id={tooltipId} ref={tooltipRef} role="tooltip">
      {details}
    </div>}
    <span className="practice__announcement" role="status">{details}</span>
  </div>;
}

export function VocabularyQuiz({
  practice, progress, asOf, loading, onSaveError, onComboOutcome, playSuccessSound, saveOutcome, singleTitle, dialogRef,
  renderCombo, renderProgress,
}) {
  const [question, setQuestion] = useState(null);
  const [lastPhrase, setLastPhrase] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [completed, setCompleted] = useState(false);
  const game = useRef({ page: null, question: null, turn: 0, lastPlayed: new Map(), timer: null });
  const board = useRef(null);
  const focused = useRef(false);
  const deck = practice.deck;
  const questionId = question?.id;

  function present(next) {
    const current = game.current;
    current.question = next ? { ...next, id: crypto.randomUUID(), missed: false, peeked: false } : null;
    setAnnouncement("");
    setQuestion(current.question);
    if (next) {
      setLastPhrase(next.phrase);
      void savePracticeAppearances([current.question], Date.now()).catch(onSaveError);
    }
  }

  const openPage = useEffectEvent(() => {
    const current = game.current;
    if (!deck?.phrases || current.page === deck.phrases) return;
    current.page = deck.phrases;
    present(nextPhraseQuestion(deck.phrases, deck.cards));
  });
  useEffect(() => { openPage(); }, [deck?.phrases]);

  const finishPage = useEffectEvent(() => {
    if (!deck || game.current.page !== deck.phrases || game.current.question || practice.error) return;
    if (deck.next) void practice.refill(true);
    else setCompleted(true);
  });
  useEffect(() => { finishPage(); }, [deck, questionId, practice.error]);

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

  function answer(index, touch = false) {
    const current = game.current;
    const shown = current.question;
    const choice = shown?.choices[index];
    if (!choice || shown.chosen) return;

    const { card, choices } = shown;
    const correct = choice.id === card.id;
    if (!shown.missed) {
      const lastTurn = current.lastPlayed.get(card.id) ?? -Infinity;
      saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2 }, choice.meaning);
      current.lastPlayed.set(card.id, current.turn++);
    }
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (!correct) onComboOutcome("miss");
    else {
      if (!shown.peeked && !shown.missed) onComboOutcome("correct");
      playSuccessSound();
    }
    setAnnouncement(correct ? "Correct." : "Incorrect. Try again.");
    current.question = { ...shown, chosen: choice.id, feedback: correct ? "correct" : "incorrect",
      missed: shown.missed || !correct };
    setQuestion(current.question);
    current.timer = setTimeout(() => {
      current.timer = null;
      if (correct) {
        present(nextPhraseQuestion(deck.phrases, deck.cards, shown.line, shown.word + 1));
      } else {
        current.question = { ...current.question, chosen: null, feedback: null };
        setAnnouncement("");
        setQuestion(current.question);
      }
    }, correct ? correctFeedbackMs : incorrectFeedbackMs);
  }

  function peekAtWord() {
    const current = game.current;
    if (!current.question || current.question.chosen) return false;
    current.question.peeked = true;
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
  const phrase = shown?.phrase;
  const timeline = phrase ?? lastPhrase;
  return <>{renderCombo()}
  <div className="practice__quiz-session">
    {renderProgress(singleTitle && timeline?.duration > 0 &&
      <EpisodeTimeline duration={timeline.duration} time={completed ? timeline.duration : timeline.time} />)}
    {!shown && !practice.error && (completed
      ? <p role="status">{game.current.turn ? "Practice complete." : "There aren’t any subtitle words available for this quiz."}</p>
      : loading)}
    {shown && <div className="practice__quiz" ref={board} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__quiz-prompt">
        <ContextPrompt key={shown.id} example={shown.example} cardId={shown.card.id}
          progress={progress} asOf={asOf} onPeek={peekAtWord}>
          <p id="practice-translation" className="practice__quiz-translation" lang="en">
            {phrase.translation ?? "English translation unavailable."}
          </p>
        </ContextPrompt>
      </div>
      <div className="practice__quiz-response">
        <div className="practice__quiz-choices" role="group" aria-label="Choose the English meaning"
          aria-describedby="practice-prompt practice-translation">
          {shown.choices.map((choice, index) => {
            const feedback = choice.id === shown.chosen ? shown.feedback : undefined;
            return <button type="button" className="practice__quiz-choice" key={index}
              aria-keyshortcuts={shown.chosen ? undefined : quizKeys[index]}
              aria-disabled={shown.chosen ? true : undefined} data-quiz-feedback={feedback}
              data-chosen={feedback ? "true" : undefined}
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
      <span lang="ja">{phrase?.kana}</span>{" "}
      <span lang="ja-Latn">{phrase?.romaji}</span>{" "}
      <span lang="en">{phrase?.translation}</span>{" "}
      <span lang="ja">{shown && Array.from(shown.example[1])
        .slice(shown.example[3], shown.example[4]).join("")}</span>
    </span>
    <span className="practice__announcement" role="status">{announcement}</span>
  </div></>;
}
