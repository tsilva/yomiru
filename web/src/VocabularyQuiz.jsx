import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { conjugationGuides, verbGroupLabels } from "./conjugation-guides.mjs";
import { EpisodeTimeline } from "./EpisodeTimeline.jsx";
import { isFirstRecallDue, masteryAt, recallReviewDue } from "./vocabulary-practice.mjs";
import { savePracticeAppearances } from "./vocabulary-practice-storage.mjs";
import { nextPhraseQuestion, quizContextSpans, quizKeys } from "./vocabulary-quiz.mjs";

const correctFeedbackMs = 350;
const incorrectFeedbackMs = 500;
const tapVibrationMs = 35;

function ReviewResult({ count, practiced, includesForms, repeatButton, onRepeat }) {
  const unit = includesForms ? "question" : "word";
  return <section className="practice__review-result">
    <div className="practice__review-art" aria-hidden="true">
      <img src="/assets/fox.png" width="256" height="256" alt="" />
      {count > 0 && <span>✓</span>}
    </div>
    <div role="status">
      <h3>{count > 0 ? "Review complete" : "Nothing to review yet"}</h3>
      {count > 0 ? <p>{count.toLocaleString()} {unit}{count === 1 ? "" : "s"} reviewed</p>
        : <p>{practiced ? "No reviewed questions match your practice history yet."
          : "Practice an episode to build your review queue."}</p>}
    </div>
    {count > 0 && <button type="button" className="install" ref={repeatButton} onClick={onRepeat}>
      <span className="install__face">Review again</span>
    </button>}
  </section>;
}

function ConjugationReadings({ written, kana, romaji, showWritten = true }) {
  return <>
    <span className="practice__japanese-readings" lang="ja">
      {showWritten && <span className="practice__original-japanese">{written}</span>}
      <strong>{kana}</strong>
    </span>
    <span lang="ja-Latn">{romaji}</span>
  </>;
}

function guideRule(text) {
  return text.split(/\*\*([^*]+)\*\*/u).map((part, index) =>
    index % 2 ? <strong key={index}>{part}</strong> : part);
}

function ConjugationGuide({ form }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef(null);
  const guide = conjugationGuides[form.id];
  return <div className="practice__conjugation-help" onKeyDown={event => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    button.current.focus();
  }}>
    <div className="practice__conjugation-label">
      <span id="practice-conjugation">{form.label}</span>
      {guide && <button ref={button} type="button" className="practice__conjugation-help-button"
        aria-label={`Help with ${form.label}`} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(previous => !previous)}><span aria-hidden="true">?</span></button>}
    </div>
    {guide && <section id={id} hidden={!open} className="practice__conjugation-guide"
      aria-labelledby="practice-conjugation" lang="en">
      <p>{guide.use}</p>
      {guide.common ? <p>{guideRule(guide.common)}</p> : <dl>
        {Object.entries(guide.groups).map(([group, rule]) => <div key={group}
          data-current={group === form.group || undefined}>
          <dt>{verbGroupLabels[group]}</dt>
          <dd>{guideRule(rule)}</dd>
        </div>)}
      </dl>}
    </section>}
  </div>;
}

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

function ContextPrompt({ example, japanese, japaneseTarget, cardId, progress, asOf, onPeek, children }) {
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
    if (!onPeek) return text;
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
      <div className="practice__japanese-readings" lang="ja">
        {japanese && <span className="practice__original-japanese">
          {japaneseTarget ? <ContextLine text={japanese} spans={[{ japanese: japaneseTarget }]} script="japanese" />
            : japanese}
        </span>}
        <strong><ContextLine text={kana} spans={spans} script="kana" renderWord={renderWord} /></strong>
      </div>
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
  practice, progress, conjugationProgress, asOf, loading, onSaveError, onComboOutcome, playSuccessSound,
  saveOutcome, episodeId, singleTitle, dialogRef, renderCombo, renderProgress, reviewing, conjugating,
}) {
  const [question, setQuestion] = useState(null);
  const [lastPhrase, setLastPhrase] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [completed, setCompleted] = useState(false);
  const game = useRef({ page: null, question: null, turn: 0, lastPlayed: new Map(), timer: null,
    pendingQuestions: [] });
  const board = useRef(null);
  const repeatButton = useRef(null);
  const focused = useRef(false);
  const deck = practice.deck;
  const queued = reviewing || conjugating;
  const page = queued ? deck?.reviewQuestions : deck?.phrases;
  const questionId = question?.id;

  function show(next) {
    const current = game.current;
    const now = Date.now();
    const record = next && (next.conjugation ? conjugationProgress : progress).get(next.card.id);
    const delayedReview = next && !reviewing && !current.lastPlayed.has(next.card.id)
      && (recallReviewDue(next.card, record, now) || (next.conjugation && isFirstRecallDue(record, now)));
    current.question = next ? { ...next, id: crypto.randomUUID(), missed: false, peeked: false, delayedReview } : null;
    setAnnouncement("");
    setQuestion(current.question);
    if (next) {
      setLastPhrase(next.phrase);
      void savePracticeAppearances([current.question], now, Boolean(next.conjugation), episodeId).catch(onSaveError);
    }
  }

  const openPage = useEffectEvent(() => {
    const current = game.current;
    if (!page || current.page === page) return;
    current.page = page;
    setCompleted(false);
    if (queued) {
      current.lastPlayed.clear();
      current.pendingQuestions = page.slice(1);
      show(page[0]);
    } else show(nextPhraseQuestion(deck.phrases, deck.cards));
  });
  useEffect(() => { openPage(); }, [page]);

  const finishPage = useEffectEvent(() => {
    if (!page || game.current.page !== page || game.current.question || practice.error) return;
    if (deck.next) void practice.refill(true);
    else setCompleted(true);
  });
  useEffect(() => { finishPage(); }, [deck, questionId, practice.error]);

  useEffect(() => {
    const current = game.current;
    return () => clearTimeout(current.timer);
  }, []);
  useLayoutEffect(() => {
    if (completed && document.activeElement === document.body) repeatButton.current?.focus({ preventScroll: true });
    if (!questionId) return;
    const dialog = dialogRef.current;
    if (dialog.scrollTop) dialog.scrollTop = 0;
    if (!focused.current || document.activeElement === document.body || board.current.contains(document.activeElement)) {
      focused.current = true;
      board.current.focus({ preventScroll: true });
    }
  }, [completed, dialogRef, questionId]);

  function answer(index, touch = false) {
    const current = game.current;
    const shown = current.question;
    const choice = shown?.choices[index];
    if (!choice || shown.chosen) return;

    const { card, choices } = shown;
    const correct = choice.id === card.id;
    if (!shown.missed) {
      const lastTurn = current.lastPlayed.get(card.id) ?? -Infinity;
      const review = reviewing || shown.delayedReview;
      saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2, review },
        shown.conjugation ? shown.conjugation.label : review && !correct ? null : choice.meaning);
      current.lastPlayed.set(card.id, current.turn++);
    }
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (!reviewing && !correct) onComboOutcome("miss");
    if (!reviewing && correct && !shown.peeked && !shown.missed) onComboOutcome("correct");
    if (correct) playSuccessSound();
    setAnnouncement(correct ? "Correct." : "Incorrect. Try again.");
    current.question = { ...shown, chosen: choice.id, feedback: correct ? "correct" : "incorrect",
      missed: shown.missed || !correct };
    setQuestion(current.question);
    current.timer = setTimeout(() => {
      current.timer = null;
      if (correct) {
        if (queued) show(current.pendingQuestions.shift());
        else show(nextPhraseQuestion(deck.phrases, deck.cards, shown.line, shown.word + 1));
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
  const form = shown?.conjugation;
  const showTranslation = !form && !reviewing && !shown?.delayedReview;
  const timeline = phrase ?? lastPhrase;
  const position = queued && page ? page.length - game.current.pendingQuestions.length : 0;
  const includesForms = reviewing && page?.some(question => question.conjugation);
  const reviewStatus = reviewing && shown && <span className="practice__mastery">
    {includesForms ? "Question" : "Word"} {position} of {page.length}
  </span>;
  const completion = game.current.turn ? "Practice complete." : conjugating
    ? "There aren’t any prepared verb forms for this episode yet." : "There aren’t any subtitle words available for this quiz.";
  return <>{!reviewing && renderCombo()}
  <div className="practice__quiz-session">
    {renderProgress(singleTitle && timeline?.duration > 0 &&
      <EpisodeTimeline duration={timeline.duration} time={completed ? timeline.duration : timeline.time} />, reviewStatus,
    conjugating && page?.length > 0 && { number: completed ? page.length : position, total: page.length })}
    {!shown && !practice.error && (completed
      ? reviewing ? <ReviewResult count={page.length} includesForms={includesForms}
        practiced={progress.size > 0 || conjugationProgress.size > 0}
        repeatButton={repeatButton} onRepeat={practice.repeatReview} />
        : conjugating && page.length ? <section className="practice__review-result">
          <div role="status"><h3>Round complete</h3><p>{page.length} verb forms practised</p></div>
          <button type="button" className="install" ref={repeatButton} onClick={practice.repeatReview}>
            <span className="install__face">Keep practising</span>
          </button>
        </section> : <p role="status">{completion}</p>
      : loading)}
    {shown && <div className="practice__quiz" data-conjugation={Boolean(form) || undefined}
      ref={board} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__quiz-prompt">
        {form ? <div className="practice__context">
          <div className="practice__prompt" id="practice-prompt" data-context="true"
            style={{ "--context-length": Array.from(form.prompt.kana).length }}>
            <ConjugationReadings {...form.prompt} />
          </div>
          <div className="practice__conjugation-meaning">
            <p id="practice-translation" className="practice__quiz-translation" lang="en">{form.prompt.meaning}</p>
            {form.group && <span id="practice-verb-type" className="practice__verb-type">
              <span className="sr-only">Verb type </span>{verbGroupLabels[form.group]}
            </span>}
          </div>
        </div> : <ContextPrompt key={shown.id} example={shown.example} cardId={shown.card.id}
          japanese={!reviewing || phrase.japaneseTargets?.[shown.word] ? phrase.japanese : undefined}
          japaneseTarget={phrase.japaneseTargets?.[shown.word]}
          progress={progress} asOf={asOf} onPeek={showTranslation ? peekAtWord : undefined}>
          {showTranslation && <p id="practice-translation" className="practice__quiz-translation" lang="en">
            {phrase.translation ?? "English translation unavailable."}
          </p>}
        </ContextPrompt>}
      </div>
      <div className="practice__quiz-response">
        {form && <ConjugationGuide key={shown.id} form={form} />}
        <div className="practice__quiz-choices" role="group"
          aria-label={form ? undefined : "Choose the English meaning"}
          aria-labelledby={form ? "practice-conjugation" : undefined}
          aria-describedby={form?.group ? "practice-prompt practice-translation practice-verb-type"
            : showTranslation || form ? "practice-prompt practice-translation" : "practice-prompt"}>
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
                {form ? <span className="practice__conjugation-reading">
                  <ConjugationReadings {...choice} showWritten={choice.written !== choice.kana} />
                </span> : <span lang="en">{choice.meaning}</span>}
                {feedback && <span className="practice__quiz-feedback" aria-hidden="true">
                  {feedback === "correct" ? "✓" : "×"}
                </span>}
              </span>
            </button>;
          })}
        </div>
      </div>
    </div>}
    <span className="practice__announcement" aria-live="polite">{form ? <>
      <span lang="ja">{form.prompt.kana}</span>{" "}
      <span lang="en">{form.prompt.meaning}. {form.group && `${verbGroupLabels[form.group]} verb. `}{form.label}.</span>
    </> : <>
      <span lang="ja">{phrase?.kana}</span>{" "}
      <span lang="ja-Latn">{phrase?.romaji}</span>{" "}
      <span lang="en">{showTranslation && phrase?.translation}</span>{" "}
      <span lang="ja">{shown && Array.from(shown.example[1])
        .slice(shown.example[3], shown.example[4]).join("")}</span>
    </>}</span>
    <span className="practice__announcement" role="status">{announcement}</span>
  </div></>;
}
