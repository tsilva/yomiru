import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PracticeLoading } from "./VocabularyPractice.jsx";
import { JapaneseReadings, QuizAnswer } from "./VocabularyQuiz.jsx";
import { quizKeys } from "./vocabulary-quiz.mjs";
import { saveDictionaryAnswer } from "./vocabulary-practice-storage.mjs";
import { buildWordDrill, loadDictionaryEntries } from "./word-drill.mjs";
import matchSuccessSound from "./match-success.wav";

function DrillReadings({ card }) {
  const { word, kana, romaji } = card;
  return <JapaneseReadings written={word} kana={kana} romaji={romaji?.toLowerCase()}
    showWritten={/\p{Script=Han}/u.test(word)} />;
}

function DrillRound({ questions, onProgress, onAgain }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [saveError, setSaveError] = useState(false);
  const answerLocked = useRef(false);
  const pending = useRef(null);
  const sound = useRef(null);
  const finish = useRef(null);
  const round = useRef({ shownAt: Date.now(), attempted: false });
  const question = questions[index];

  useEffect(() => () => clearTimeout(pending.current), []);
  useLayoutEffect(() => {
    if (index === questions.length) finish.current?.focus({ preventScroll: true });
  }, [index, questions.length]);

  function answer(choiceIndex, touch = false) {
    if (!question || answerLocked.current) return;
    const option = question.choices[choiceIndex];
    if (!option) return;
    answerLocked.current = true;
    const correct = option.id === question.card.id;
    setSelected({ choiceIndex, feedback: correct ? "correct" : "incorrect" });
    setAnnouncement(correct ? "Correct." : "Try again.");
    if (!round.current.attempted) {
      round.current.attempted = true;
      void saveDictionaryAnswer(question.card, { shownAt: round.current.shownAt, correct,
        choices: question.choices.length, direction: question.toKana ? "to-kana" : "to-english", at: Date.now() })
        .catch(() => setSaveError(true));
    }
    if (correct) {
      sound.current.currentTime = 0;
      void sound.current.play().catch(() => {});
    } else if (touch) navigator.vibrate?.(35);
    pending.current = setTimeout(() => {
      answerLocked.current = false;
      setSelected(null);
      setAnnouncement("");
      if (correct) {
        round.current = { shownAt: Date.now(), attempted: false };
        setIndex(index + 1);
        onProgress(index + 1);
      }
    }, correct ? 350 : 500);
  }

  return <>
    <audio ref={sound} src={matchSuccessSound} preload="auto" />
    {saveError && <p className="practice__notices" role="alert">Word Drill progress couldn’t be saved.</p>}
    {!question ? <section className="practice__review-result">
      <div className="practice__review-art"><img src="/assets/fox.png" width="256" height="256" alt="" /></div>
      <h3>Word Drill complete</h3>
      <p>{questions.length} words practiced</p>
      <button type="button" className="install" ref={finish} onClick={onAgain}>
        <span className="install__face">Practice again</span>
      </button>
    </section> : <div className="practice__quiz" data-japanese-answers={question.toKana || undefined}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
        const choiceIndex = quizKeys.indexOf(event.key);
        if (choiceIndex < 0) return;
        event.preventDefault();
        answer(choiceIndex);
      }} ref={element => {
        if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
      }} tabIndex={-1}>
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
    <span className="sr-only" role="status">{announcement}</span>
  </>;
}

export function WordDrill({ loadDictionary, stars, onClose }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState(null);
  const [completed, setCompleted] = useState(0);
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
    setCompleted(0);
    setRequest(request + 1);
  }

  return <dialog className="practice" ref={dialog} aria-labelledby="word-drill-title" onClose={onClose}>
    <div className="practice__content" data-game="quiz" data-word-drill>
      <header className="practice__toolbar">
        <div className="practice__toolbar-row">
          <button type="button" className="practice__back" onClick={() => dialog.current.close()}>
            <span aria-hidden="true">←</span> Library
          </button>
          <div className="practice__toolbar-title">
            <h2 id="word-drill-title" className="practice__screen-name" ref={heading} tabIndex={-1}>Word Drill</h2>
          </div>
          <div className="practice__toolbar-status">
            {Boolean(total) && completed < total && <span className="practice__round-count">{completed + 1} of {total}</span>}
          </div>
        </div>
        {Boolean(total) && <progress className="word-drill__progress" aria-label="Round progress" value={completed} max={total} />}
      </header>
      {!current ? <PracticeLoading /> : current.error ? <section className="practice__review-result">
        <p role="alert">{current.error}</p>
        <button type="button" className="install" onClick={again}><span className="install__face">Try again</span></button>
      </section> : total ? <DrillRound key={request} questions={current.questions} onProgress={setCompleted} onAgain={again} />
        : <p className="practice__review-result" role="status">No words are available for Word Drill.</p>}
    </div>
  </dialog>;
}
