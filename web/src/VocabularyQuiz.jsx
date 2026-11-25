import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { conjugationGuides, verbGroupLabels } from "./conjugation-guides.mjs";
import { EpisodeTimeline } from "./EpisodeTimeline.jsx";
import { PracticeChat } from "./PracticeChat.jsx";
import { isFirstRecallDue, masteryAt, recallReviewDue } from "./vocabulary-practice.mjs";
import { createSubtitlePractice, nextPhraseQuestion, quizChatQuestion, quizContextSpans, quizKeys } from "./vocabulary-quiz.mjs";
import { vocabularyCategory } from "./vocabulary-study.mjs";

const correctFeedbackMs = 350;
const incorrectFeedbackMs = 500;
const tapVibrationMs = 35;

export function QuizAnswer({ index, locked, feedback, onPick, children }) {
  return <button type="button" className="practice__quiz-choice"
    aria-keyshortcuts={locked ? undefined : quizKeys[index]} aria-disabled={locked || undefined}
    data-quiz-feedback={feedback} data-chosen={feedback ? "true" : undefined}
    onClick={({ nativeEvent }) => {
      const touch = nativeEvent.pointerType === "touch" || nativeEvent.sourceCapabilities?.firesTouchEvents === true;
      onPick(index, touch);
    }}>
    <span className="practice__quiz-choice-face">
      <kbd aria-hidden="true">{quizKeys[index]}</kbd>
      {children}
      {feedback && <span className="practice__quiz-feedback" aria-hidden="true">
        {feedback === "correct" ? "✓" : "×"}
      </span>}
    </span>
  </button>;
}

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

export function JapaneseReadings({ written, kana, romaji, showWritten = true }) {
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
  const help = useRef(null);
  useEffect(() => {
    if (!open) return;
    function dismissOutside(event) {
      if (!help.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);
  const rulesByGroup = guide?.common && verbGroupLabels[form.group]
    ? { [form.group]: guide.common }
    : guide?.groups;
  const groupRules = Object.entries(rulesByGroup ?? {}).sort(([left], [right]) =>
    Number(right === form.group) - Number(left === form.group));
  return <div className="practice__conjugation-help" ref={help} onKeyDown={event => {
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
    {guide && <section id={id} hidden={!open} className="practice__conjugation-guide" role="tooltip"
      aria-labelledby="practice-conjugation" lang="en">
      <p>{guide.use}</p>
      {groupRules.length ? <dl>
        {groupRules.map(([group, rule]) => <div key={group}>
          <dt aria-current={group === form.group || undefined}>{verbGroupLabels[group]}</dt>
          <dd>{guideRule(rule)}</dd>
        </div>)}
      </dl> : <p>{guideRule(guide.common)}</p>}
    </section>}
  </div>;
}

function ContextLine({ text, spans, script, renderWord, markTarget = true }) {
  const characters = Array.from(text);
  let previousEnd = 0;
  const pieces = spans.map(({ id, [script]: [start, end] }, index) => {
    const before = characters.slice(previousEnd, start).join("");
    const word = characters.slice(start, end).join("");
    previousEnd = end;
    const content = id ? renderWord(word, index, script) : markTarget ? <mark>{word}</mark> : word;
    return <span key={start}>{before}{content}</span>;
  });
  return <>{pieces}{characters.slice(previousEnd).join("")}</>;
}

function ContextPrompt({ example, japanese, japaneseTarget, cardId, progress, asOf, onPeek, onAsk, markTarget, children }) {
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
    : word?.pos === "助詞" ? null : "Not practiced";
  const kanaReading = word && Array.from(kana).slice(...word.kana).join("");
  const written = word?.written !== kanaReading && /\p{Script=Han}/u.test(word?.written ?? "") ? word.written : null;
  const category = word?.pos && vocabularyCategory(word.pos);
  const verbClass = word?.pos === "動詞" && verbGroupLabels[word.verbGroup];
  const details = word && <>
    <span className="practice__peek-readings">
      <strong lang="ja">{written || kanaReading}</strong>{" "}
      {written && <span className="practice__peek-reading">
        <span aria-hidden="true">·</span>{" "}<span lang="ja">{kanaReading}</span>
      </span>}{" "}
      <span className="practice__peek-reading">
        <span aria-hidden="true">·</span>{" "}
        <span lang="ja-Latn">{Array.from(romaji).slice(...word.romaji).join("")}</span>
      </span>
    </span>{" "}
    <span lang="en">{word.meaning}</span>{" "}
    {(category || mastery) && <small className="practice__peek-meta" lang="en">
      {category && <span>{category}{verbClass && ` · ${verbClass}`}</span>}{" "}
      {mastery && <span>{mastery}</span>}
    </small>}
  </>;

  useLayoutEffect(() => {
    if (!peek) return;
    const prompt = promptRef.current;
    const readingArea = prompt.parentElement;
    const responseArea = readingArea.nextElementSibling;
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
      const above = bounds.bottom + gap + height > responseArea.getBoundingClientRect().top;
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
    observer.observe(responseArea);
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
        <strong><ContextLine text={kana} spans={spans} script="kana" renderWord={renderWord} markTarget={markTarget} /></strong>
      </div>
      <span lang="ja-Latn"><ContextLine text={romaji} spans={spans} script="romaji" renderWord={renderWord} markTarget={markTarget} /></span>
    </div>
    {children}
    {peek && <div className="practice__peek-tooltip" id={tooltipId} ref={tooltipRef}
      role={onAsk ? "group" : "tooltip"} aria-label={onAsk ? "Word lookup" : undefined}>
      {details}
      {onAsk && <button type="button" className="practice-chat__word" onClick={() => {
        onAsk({ surface: word.written || kanaReading, reading: kanaReading, meaning: word.meaning });
        setPeek(null);
      }}>Ask about this word</button>}
    </div>}
    <span className="practice__announcement" role="status">{details}</span>
  </div>;
}

function chatLine(phrase) {
  const japanese = phrase?.japanese || phrase?.kana;
  return japanese ? { japanese, translation: phrase.translation || undefined } : null;
}

export function VocabularyQuiz({
  practice, progress, conjugationProgress, asOf, loading, saveAppearances, saveTeaching, onComboOutcome, playSuccessSound,
  saveOutcome, episodeId, singleTitle, dialogRef, renderProgress, reviewing, conjugating,
}) {
  const [question, setQuestion] = useState(null);
  const [lastQuestion, setLastQuestion] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [completed, setCompleted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekError, setSeekError] = useState("");
  const [chat, setChat] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [completedAnswers, setCompletedAnswers] = useState([]);
  const chatId = useId();
  const chatButton = useRef(null);
  const newWordLabel = useId();
  const [subtitles] = useState(createSubtitlePractice);
  // Keep pending retries and first-attempt credit when returning to a subtitle.
  const game = useRef({ page: null, question: null, turn: 0, lastPlayed: new Map(), timer: null, seeking: false,
    triedOccurrences: new Map(), pendingQuestions: [], previousPhrase: null, lastPhrase: null, chatOpen: false,
    finishFeedback: null });
  const board = useRef(null);
  const repeatButton = useRef(null);
  const focused = useRef(false);
  const deck = practice.deck;
  const queued = reviewing || conjugating;
  const page = queued ? deck?.reviewQuestions : deck?.phrases;
  const questionId = question?.id;

  function show(next, replay = false) {
    const current = game.current;
    const now = Date.now();
    const occurrence = !queued && next ? JSON.stringify([next.phrase.cue, next.word]) : null;
    const retry = occurrence && current.triedOccurrences.get(occurrence);
    const record = next && (next.conjugation ? conjugationProgress : progress).get(next.card.id);
    const teaching = next && !queued && subtitles.isNewWord(next.card, record);
    const delayedReview = next && !reviewing && !current.lastPlayed.has(next.card.id)
      && (recallReviewDue(next.card, record, now) || (next.conjugation && isFirstRecallDue(record, now)));
    current.question = retry ? { ...retry, line: next.line }
      : next ? { ...next, occurrence, id: crypto.randomUUID(), missedChoices: [], peeked: false,
        delayedReview, teaching, replay } : null;
    setAnnouncement(replay ? "Let’s practice this line again." : "");
    setSeekError("");
    setQuestion(current.question);
    if (next) {
      if (current.lastPhrase && current.lastPhrase.cue !== next.phrase?.cue) current.previousPhrase = current.lastPhrase;
      current.lastPhrase = next.phrase;
      setLastQuestion(current.question);
      if (!current.triedOccurrences.has(occurrence)) {
        saveAppearances([current.question], now, Boolean(next.conjugation));
      }
    }
  }

  function showNextPhrase(line = 0) {
    show(nextPhraseQuestion(deck.phrases, deck.cards, line, 0, Math.random() < .5, deck.fallbackCards));
  }

  function advanceSubtitle(shown) {
    const { question: next, replay } = subtitles.advance(deck, shown, Math.random() < .5);
    show(next, replay);
  }

  function teach() {
    const current = game.current;
    const shown = current.question;
    if (!shown?.teaching || current.seeking || current.chatOpen) return;
    subtitles.teach(shown);
    saveTeaching(shown.card);
    advanceSubtitle(shown);
  }

  async function jumpToPhrase([, cue, after]) {
    const current = game.current;
    if (current.seeking || current.chatOpen || current.question?.chosen || (!current.question && !completed)) return;
    const line = page.findIndex(phrase => phrase.cue.endsWith(`:${cue}`));
    if (line >= 0) {
      setCompleted(false);
      showNextPhrase(line);
      return;
    }
    current.seeking = true;
    setSeeking(true);
    setSeekError("");
    try {
      await practice.seek(after);
    } catch {
      setSeekError("Couldn’t jump to that subtitle. Try scrubbing again.");
    } finally {
      current.seeking = false;
      setSeeking(false);
    }
  }

  const openPage = useEffectEvent(() => {
    const current = game.current;
    if (!page || current.page === page || current.chatOpen) return;
    current.page = page;
    setCompleted(false);
    if (queued) {
      current.lastPlayed.clear();
      current.pendingQuestions = page.slice(1);
      show(page[0]);
    } else showNextPhrase();
  });
  useEffect(() => { openPage(); }, [page, chatOpen]);

  const finishPage = useEffectEvent(() => {
    if (!page || game.current.page !== page || game.current.question || game.current.chatOpen || practice.error) return;
    if (deck.next) void practice.refill(true);
    else setCompleted(true);
  });
  useEffect(() => { finishPage(); }, [deck, questionId, completed, chatOpen, practice.error]);

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
    if (!choice || shown.teaching || shown.chosen || current.seeking || current.chatOpen) return;

    const { card, choices } = shown;
    const correct = choice.id === card.id;
    const firstAttempt = !shown.missedChoices.length && !current.triedOccurrences.has(shown.occurrence);
    if (firstAttempt && !shown.chatAssisted) {
      const lastTurn = current.lastPlayed.get(card.id) ?? -Infinity;
      const review = reviewing || shown.delayedReview;
      saveOutcome(shown, { correct, choices: choices.length, spaced: current.turn - lastTurn >= 2, review });
      current.lastPlayed.set(card.id, current.turn);
    }
    if (firstAttempt) current.turn++;
    const missedChoices = correct || shown.missedChoices.includes(index) ? shown.missedChoices : [...shown.missedChoices, index];
    if (shown.occurrence) current.triedOccurrences.set(shown.occurrence, correct ? null : { ...shown, missedChoices });
    if (touch) navigator.vibrate?.(tapVibrationMs);
    if (!reviewing && !correct) onComboOutcome("miss");
    if (!reviewing && correct && !shown.peeked && !shown.chatAssisted && firstAttempt) onComboOutcome("correct");
    if (correct) {
      const answered = { ...quizChatQuestion(shown), correctChoice: index, missedChoices };
      setCompletedAnswers(previous => [...previous, { ...answered, number: previous.length + 1 }]);
      playSuccessSound();
    }
    setAnnouncement(correct ? "Correct." : "Incorrect. Try again.");
    current.question = { ...shown, chosen: choice.id, feedback: correct ? "correct" : "incorrect",
      missedChoices };
    setQuestion(current.question);
    const finish = () => {
      if (correct) {
        if (queued) show(current.pendingQuestions.shift());
        else advanceSubtitle(shown);
      } else {
        current.question = { ...current.question, chosen: null, feedback: null };
        setAnnouncement("");
        setQuestion(current.question);
      }
    };
    current.timer = setTimeout(() => {
      current.timer = null;
      if (current.chatOpen) current.finishFeedback = finish;
      else finish();
    }, correct ? correctFeedbackMs : incorrectFeedbackMs);
  }

  function peekAtWord() {
    const current = game.current;
    if (!current.question || current.question.chosen || current.seeking) return false;
    current.question.peeked = true;
    onComboOutcome("reset");
    return true;
  }

  function handleKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    const index = quizKeys.indexOf(event.key);
    if (index === -1) return;
    event.preventDefault();
    if (game.current.question?.teaching) {
      if (index === 0) teach();
      return;
    }
    answer(index);
  }

  const shown = question;
  const phrase = shown?.phrase;
  const form = shown?.conjugation;
  const teaching = shown?.teaching;
  const englishTarget = teaching ? undefined : shown?.englishTarget;
  const japaneseChoices = Boolean(form || englishTarget);
  const replayingCue = subtitles.hasReplay(phrase?.cue);
  const showTranslation = !form && !reviewing && (!replayingCue || teaching || englishTarget);
  const presented = shown ?? lastQuestion;
  const timeline = presented?.phrase;
  const assessed = shown && !teaching && !shown.chosen ? shown.id : null;
  const activeQuestion = shown && !teaching && shown.feedback !== "correct" && quizChatQuestion(shown);
  const currentContext = chatContext(timeline, undefined, assessed, activeQuestion, presented?.conjugation);
  const available = Boolean(currentContext);
  const duration = deck?.timeline?.duration ?? timeline?.duration;
  const media = episodeId?.includes(":") ? "episode" : "movie";
  const position = queued && page ? page.length - game.current.pendingQuestions.length : 0;
  const includesForms = reviewing && page?.some(question => question.conjugation);
  const round = queued && page?.length > 0 && (shown || completed)
    ? { number: completed ? page.length : position, total: page.length } : undefined;
  const completion = game.current.turn ? "Practice complete." : conjugating
    ? `There aren’t any prepared verb forms for this ${media} yet.` : "There aren’t any subtitle words available for this quiz.";

  function chatContext(line, word, assessed, activeQuestion, verb) {
    const index = !queued && line ? page?.findIndex(item => item.cue === line.cue) ?? -1 : -1;
    const data = verb ? { kind: "verb", japanese: verb.prompt.written || verb.prompt.kana,
      translation: verb.prompt.meaning } : chatLine(line);
    return data && {
      id: JSON.stringify([line?.cue ?? verb?.id, word?.surface, assessed]), time: line?.time, assessed,
      assisted: Boolean(assessed), promptLanguage: assessed && !verb && !showTranslation ? "ja" : undefined,
      data: { ...data, word, previous: index > 0 ? chatLine(page[index - 1]) : null,
        next: index >= 0 ? chatLine(page[index + 1]) : null, ...(activeQuestion && { question: activeQuestion }) },
    };
  }

  function openChat(word) {
    if (!available || game.current.seeking) return;
    const current = word ? chatContext(timeline, word, assessed, activeQuestion) : currentContext;
    const previous = !queued && chatContext(game.current.previousPhrase);
    setChat({ current, previous, active: current });
    game.current.chatOpen = true;
    setChatOpen(true);
  }

  function closeChat() {
    const current = game.current;
    current.chatOpen = false;
    const finish = current.finishFeedback;
    current.finishFeedback = null;
    setChatOpen(false);
    chatButton.current?.focus({ preventScroll: true });
    finish?.();
  }

  function markChatAssisted(questionId) {
    const current = game.current.question;
    if (!current || current.id !== questionId || current.chatAssisted || current.feedback === "correct") return;
    current.chatAssisted = true;
    if (!reviewing && !current.peeked) onComboOutcome("reset");
  }

  function repeatRound() {
    if (chatOpen) closeChat();
    setCompletedAnswers([]);
    setLastQuestion(null);
    setChat(null);
    practice.repeatReview();
  }

  return <div className="practice__quiz-session" data-chat-open={chatOpen || undefined}>
    {renderProgress({
      timeline: !queued && singleTitle && duration > 0 && <EpisodeTimeline duration={duration} stops={deck?.timeline?.stops}
        time={completed ? duration : timeline?.time} blocked={chatOpen || seeking || Boolean(shown?.chosen) || (!shown && !completed)}
        label={media === "episode" ? "Episode" : "Movie"} onJump={jumpToPhrase} />,
      round,
      source: reviewing && !form && shown && { title: shown.title, time: phrase?.time },
      chatToggle: available && { button: chatButton, id: chat?.previous && chat.active === chat.previous ? `${chatId}-previous` : chatId, open: chatOpen,
        onToggle: chatOpen ? closeChat : () => openChat() },
    })}
    {seekError && <p role="status">{seekError}</p>}
    {!shown && !practice.error && (completed
      ? reviewing ? <ReviewResult count={page.length} includesForms={includesForms}
        practiced={progress.size > 0 || conjugationProgress.size > 0}
        repeatButton={repeatButton} onRepeat={repeatRound} />
        : conjugating && page.length ? <section className="practice__review-result">
          <div role="status"><h3>Round complete</h3><p>{page.length} verb forms practised</p></div>
          <button type="button" className="install" ref={repeatButton} onClick={repeatRound}>
            <span className="install__face">Keep practising</span>
          </button>
        </section> : <p className="practice__review-result" role="status">{completion}</p>
      : loading)}
    {shown && <div className="practice__quiz" data-conjugation={Boolean(form) || undefined}
      data-japanese-answers={japaneseChoices || undefined}
      ref={board} inert={chatOpen} tabIndex={-1} onKeyDown={handleKey}>
      <div className="practice__quiz-prompt">
        {form ? <div className="practice__context">
          <div className="practice__prompt" id="practice-prompt" data-context="true"
            style={{ "--context-length": Array.from(form.prompt.kana).length }}>
            <JapaneseReadings {...form.prompt} />
          </div>
          <p id="practice-translation" className="practice__quiz-translation" lang="en">
            {form.prompt.meaning}{form.english && <> <span aria-hidden="true">·</span> {form.english}</>}
          </p>
          <ConjugationGuide key={shown.id} form={form} />
        </div> : <ContextPrompt key={shown.id} example={shown.example} cardId={shown.card.id}
          japanese={!reviewing || phrase.japaneseTargets?.[shown.word] ? phrase.japanese : undefined}
          japaneseTarget={englishTarget ? undefined : phrase.japaneseTargets?.[shown.word]}
          markTarget={!englishTarget} progress={progress} asOf={asOf}
          onPeek={showTranslation && !teaching && !englishTarget && !shown.delayedReview ? peekAtWord : undefined}
          onAsk={available ? openChat : undefined}>
          {showTranslation && <p id="practice-translation" className="practice__quiz-translation" lang="en">
            {englishTarget ? <ContextLine text={phrase.translation} spans={[{ english: englishTarget }]} script="english" />
              : phrase.translation ?? "English translation unavailable."}
          </p>}
          {replayingCue && !showTranslation && <p className="practice__quiz-translation practice__quiz-replay"
            aria-hidden="true">{shown.replay && "Let’s practice this line again"}</p>}
        </ContextPrompt>}
      </div>
      <div className="practice__quiz-response">
        {teaching ? <div className="practice__quiz-teaching">
          <p id={newWordLabel}>New word</p>
          <button type="button" className="practice__quiz-choice practice__quiz-teach"
            aria-describedby={`${newWordLabel} practice-prompt`} aria-keyshortcuts={seeking ? undefined : quizKeys[0]}
            aria-disabled={seeking || undefined} onClick={teach}>
            <span className="practice__quiz-choice-face">
              <kbd aria-hidden="true">{quizKeys[0]}</kbd>
              <span lang="en">{phrase.targets[shown.word][5]?.[0] ?? shown.card.meaning}</span>
            </span>
          </button>
        </div> : <div className="practice__quiz-choices" role="group"
          aria-label={form ? undefined : englishTarget ? "Choose the Japanese word" : "Choose the English meaning"}
          aria-labelledby={form ? "practice-conjugation" : undefined}
          aria-describedby={showTranslation || form ? "practice-prompt practice-translation" : "practice-prompt"}>
          {shown.choices.map((choice, index) => {
            const feedback = choice.id === shown.chosen ? shown.feedback : undefined;
            return <QuizAnswer key={index} index={index} locked={Boolean(shown.chosen || seeking)}
              feedback={feedback} onPick={answer}>
              {japaneseChoices ? <span className="practice__conjugation-reading">
                <JapaneseReadings {...choice} showWritten={Boolean(choice.written && choice.written !== choice.kana)} />
              </span> : <span lang="en">{choice.meaning}</span>}
            </QuizAnswer>;
          })}
        </div>}
      </div>
    </div>}
    <span className="practice__announcement" aria-live="polite">{form ? <>
      <span lang="ja">{form.prompt.kana}</span>{" "}
      <span lang="en">{form.prompt.meaning}. {form.english && `${form.english}. `}{form.label}.</span>
    </> : <>
      <span lang="ja">{phrase?.kana}</span>{" "}
      <span lang="ja-Latn">{phrase?.romaji}</span>{" "}
      <span lang="en">{showTranslation && phrase?.translation}</span>{" "}
      {englishTarget ? <span lang="en">{Array.from(phrase.translation).slice(...englishTarget).join("")}</span>
        : <span lang="ja">{shown && Array.from(shown.example[1])
          .slice(shown.example[3], shown.example[4]).join("")}</span>}
    </>}</span>
    <span className="practice__announcement" role="status">{announcement}</span>
    {chat && [chat.current, chat.previous].filter(Boolean).map(context => {
      const previous = context === chat.previous;
      return <PracticeChat key={context.id} id={previous ? `${chatId}-previous` : chatId} context={context} completedAnswers={completedAnswers}
        open={chatOpen && chat.active === context} alternate={chat.previous && (previous ? "Current line" : "Previous line")}
        onSwitch={() => setChat({ ...chat, active: previous ? chat.current : chat.previous })}
        onClose={closeChat} onAssist={() => markChatAssisted(context.assessed)} />;
    })}
  </div>;
}
