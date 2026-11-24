import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { PracticeLoading } from "./VocabularyPractice.jsx";
import { JapaneseReadings, QuizAnswer } from "./VocabularyQuiz.jsx";
import { PracticeCombo, PracticeMasteryCredits, usePracticeFeedback } from "./PracticeFeedback.jsx";
import { PracticeChat } from "./PracticeChat.jsx";
import { quizKeys } from "./vocabulary-quiz.mjs";
import { saveDictionaryAnswer } from "./vocabulary-practice-storage.mjs";
import { buildWordDrill, loadDictionaryEntries } from "./word-drill.mjs";
import matchSuccessSound from "./match-success.wav";

function DrillReadings({ card }) {
  const { word, kana, romaji } = card;
  return <JapaneseReadings written={word} kana={kana} romaji={romaji?.toLowerCase()}
    showWritten={/\p{Script=Han}/u.test(word)} />;
}

function DrillRound({ questions, renderToolbar, onAgain }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [completedAnswers, setCompletedAnswers] = useState([]);
  const { combo, recordComboOutcome, masteryCredits, recordMasteryCredit } = usePracticeFeedback();
  const chatId = useId();
  const chatButton = useRef(null);
  const answerLocked = useRef(false);
  const pending = useRef(null);
  const sound = useRef(null);
  const board = useRef(null);
  const finish = useRef(null);
  const round = useRef({ shownAt: Date.now(), missedChoices: new Set() });
  const question = questions[index];
  const shown = round.current;

  useEffect(() => () => clearTimeout(pending.current), []);
  useLayoutEffect(() => {
    if (index === questions.length) finish.current?.focus({ preventScroll: true });
    else if (index === 0 || board.current?.contains(document.activeElement)) board.current?.focus({ preventScroll: true });
  }, [index, questions.length]);

  function answer(choiceIndex, touch = false) {
    if (!question || answerLocked.current || chatOpen) return;
    const option = question.choices[choiceIndex];
    if (!option) return;
    answerLocked.current = true;
    const correct = option.id === question.card.id;
    setSelected({ choiceIndex, feedback: correct ? "correct" : "incorrect" });
    setAnnouncement(correct ? "Correct." : "Try again.");
    const firstAttempt = shown.missedChoices.size === 0;
    if (!correct) {
      shown.missedChoices.add(choiceIndex);
      recordComboOutcome("miss");
    }
    if (firstAttempt && !shown.assisted) {
      if (correct) recordComboOutcome("correct");
      const { card, choices, toKana } = question;
      const at = Date.now();
      void saveDictionaryAnswer(card, { shownAt: shown.shownAt, correct,
        choices: choices.length, direction: toKana ? "to-kana" : "to-english", at }).then(result => {
        if (result) recordMasteryCredit(result.id, card, result.previous, result.word, at, correct);
      }).catch(() => setSaveError(true));
    }
    if (correct) {
      const { card, choices, toKana } = question;
      const completedAnswer = {
        toKana,
        prompt: toKana ? card.meaning : card.kana,
        choices: choices.map(choice => toKana ? choice.kana : choice.meaning),
        correctChoice: choiceIndex,
        missedChoices: [...shown.missedChoices],
      };
      setCompletedAnswers(previous => [...previous, completedAnswer]);
      sound.current.currentTime = 0;
      void sound.current.play().catch(() => {});
    } else if (touch) navigator.vibrate?.(35);
    pending.current = setTimeout(() => {
      answerLocked.current = false;
      setSelected(null);
      setAnnouncement("");
      if (correct) {
        round.current = { shownAt: Date.now(), missedChoices: new Set() };
        setIndex(index + 1);
      }
    }, correct ? 350 : 500);
  }

  function openChat() {
    if (answerLocked.current) return;
    setChatStarted(true);
    setChatOpen(true);
  }

  function closeChat() {
    setChatOpen(false);
    chatButton.current?.focus({ preventScroll: true });
  }

  const chat = { id: chatId, button: chatButton, open: chatOpen,
    disabled: Boolean(selected), onToggle: chatOpen ? closeChat : openChat };
  const card = (question ?? questions.at(-1)).card;
  return <div className="practice__quiz-session" data-chat-open={chatOpen || undefined}>
    {renderToolbar({ completed: index, total: questions.length, comboDisplay: <PracticeCombo combo={combo} chat={chat} /> })}
    <PracticeMasteryCredits {...masteryCredits} />
    <audio ref={sound} src={matchSuccessSound} preload="auto" />
    {saveError && <p className="practice__notices" role="alert">Word Drill progress couldn’t be saved.</p>}
    {!question ? <section className="practice__review-result" inert={chatOpen}>
      <div className="practice__review-art"><img src="/assets/fox.png" width="256" height="256" alt="" /></div>
      <h3>Word Drill complete</h3>
      <p>{questions.length} words practiced</p>
      <button type="button" className="install" ref={finish} onClick={onAgain}>
        <span className="install__face">Practice again</span>
      </button>
    </section> : <div className="practice__quiz" inert={chatOpen} data-japanese-answers={question.toKana || undefined}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
        const choiceIndex = quizKeys.indexOf(event.key);
        if (choiceIndex < 0) return;
        event.preventDefault();
        answer(choiceIndex);
      }} ref={board} tabIndex={-1}>
      <div className="practice__quiz-prompt" aria-live="polite">
        <div id="word-drill-prompt" className="practice__prompt" data-context={!question.toKana || undefined}
          style={question.toKana ? undefined : { "--context-length": Array.from(question.card.kana).length }}>
          {question.toKana ? <strong lang="en">{question.card.meaning}</strong> : <DrillReadings card={question.card} />}
        </div>
      </div>
      <div className="practice__quiz-response">
        <div className="practice__quiz-choices" role="group" aria-describedby="word-drill-prompt"
          aria-label={question.toKana ? "Japanese answers" : "English answers"}>
          {question.choices.map((choice, choiceIndex) =>
            <QuizAnswer key={choiceIndex} index={choiceIndex} locked={Boolean(selected)}
              feedback={selected?.choiceIndex === choiceIndex ? selected.feedback : undefined} onPick={answer}>
              {question.toKana ? <span className="practice__conjugation-reading">
                <DrillReadings card={choice} />
              </span> : <span lang="en">{choice.meaning}</span>}
            </QuizAnswer>)}
        </div>
      </div>
    </div>}
    {chatStarted && <PracticeChat id={chatId} open={chatOpen} onClose={closeChat} completedAnswers={completedAnswers}
      context={{ id: index, assisted: Boolean(question && !shown.assisted),
        promptLanguage: question && (question.toKana ? "en" : "ja"), data: { kind: "dictionary",
        word: { surface: card.written, reading: card.kana, romaji: card.romaji, meaning: card.meaning } } }}
      onAssist={() => {
        if (!question || round.current !== shown || shown.assisted) return;
        shown.assisted = true;
        recordComboOutcome("reset");
      }} />}
    <span className="sr-only" role="status">{announcement}</span>
  </div>;
}

export function WordDrill({ loadDictionary, stars, onClose }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState(null);
  const current = result?.request === request ? result : null;
  const total = current?.questions?.length;

  useLayoutEffect(() => {
    dialog.current.showModal();
    heading.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      const [favorite, first] = await Promise.all([
        loadDictionaryEntries(stars.values(), loadDictionary, signal), loadDictionary({}, signal),
      ]);
      const questions = buildWordDrill(favorite, first.words);
      if (!signal.aborted) setResult({ request, questions });
    }
    void load().catch(() => {
      if (!signal.aborted) setResult({ request, error: "Word Drill is temporarily unavailable." });
    });
    return () => controller.abort();
  }, [loadDictionary, request, stars]);

  function again() {
    setRequest(request + 1);
  }

  function renderToolbar({ completed, total, comboDisplay } = {}) {
    return <header className="practice__toolbar">
      <div className="practice__toolbar-row">
        <button type="button" className="practice__back" onClick={() => dialog.current.close()}>
          <span aria-hidden="true">←</span> Library
        </button>
        <div className="practice__toolbar-title">
          <h2 id="word-drill-title" className="practice__screen-name" ref={heading} tabIndex={-1}>Word Drill</h2>
        </div>
        <div className="practice__toolbar-status">
          {Boolean(total) && completed < total && <span className="practice__round-count">{completed + 1} of {total}</span>}
          {comboDisplay}
        </div>
      </div>
      {Boolean(total) && <progress className="word-drill__progress" aria-label="Round progress" value={completed} max={total} />}
    </header>;
  }

  return <dialog className="practice" ref={dialog} aria-labelledby="word-drill-title" onClose={onClose}>
    <div className="practice__content" data-game="quiz" data-word-drill>
      {total ? <DrillRound key={request} questions={current.questions} renderToolbar={renderToolbar} onAgain={again} /> : <>
        {renderToolbar()}
        {!current ? <PracticeLoading /> : current.error ? <section className="practice__review-result">
          <p role="alert">{current.error}</p>
          <button type="button" className="install" onClick={again}><span className="install__face">Try again</span></button>
        </section> : <p className="practice__review-result" role="status">No words are available for Word Drill.</p>}
      </>}
    </div>
  </dialog>;
}
