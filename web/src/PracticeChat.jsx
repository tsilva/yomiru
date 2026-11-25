import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { practiceChatRequest } from "../lib/practice-chat-request.mjs";
import { timestamp } from "./EpisodeTimeline.jsx";
import { formatPracticeReply } from "./practice-chat-format.mjs";
import fox from "./practice-chat-fox.webp";
import student from "./practice-chat-student.webp";
import "./practice-chat.css";

const maxQuestion = 1200;
const noAnswers = [];

function ChatAvatar({ learner = false }) {
  return <img className="practice-chat__avatar" src={learner ? student : fox} width="44" height="44" alt="" />;
}

function ChatMessage({ role, attachment, promptOnly, children }) {
  const learner = role === "user";
  return <div className="practice-chat__message" data-learner={learner || undefined}>
    <ChatAvatar learner={learner} />
    <div className="practice-chat__message-copy">
      <span className="sr-only">{learner ? "You" : "Yomiru"}</span>
      {attachment && <ChatAttachment context={attachment} promptOnly={promptOnly} />}
      <p>{learner ? children : formatPracticeReply(children).map((part, index) => typeof part === "string"
        ? part : <strong key={index} lang={part.lang}>{part.text}</strong>)}</p>
    </div>
  </div>;
}

function QuestionCard({ answer, number }) {
  const { prompt, toKana, choices, correctChoice, missedChoices, label, line } = answer;
  const promptLanguage = toKana && !label ? "en" : "ja";
  return <div className="practice-chat__drill-answer" role="group" aria-label={`Question ${number}`}>
    <span className="practice-chat__drill-number" aria-hidden="true">#{number}</span>
    <div className="practice-chat__drill-copy">
      <strong lang={promptLanguage}>{prompt}</strong>
      {label && <span className="practice-chat__question-detail" lang="en"> · {label}</span>}
      {line && line !== prompt && <p className="practice-chat__question-detail" lang={promptLanguage}>{line}</p>}
      <ul role="list" aria-label="Answer choices">
        {choices.map((choice, index) => {
          const correct = index === correctChoice;
          const missed = missedChoices?.includes(index);
          return <li key={index}>
            {index > 0 && <span aria-hidden="true">·</span>}
            <span lang={toKana ? "ja" : "en"}>{choice}</span>
            {(correct || missed) && <>
              <span className="practice-chat__drill-mark" data-correct={correct || undefined} aria-hidden="true">{correct ? "✓" : "×"}</span>
              <span className="sr-only">{correct ? "Correct answer" : "Incorrect attempt"}</span>
            </>}
          </li>;
        })}
      </ul>
    </div>
  </div>;
}

function QuotedJapanese({ text, word }) {
  if (!word) return text;
  const start = text.indexOf(word);
  if (start < 0 || text.indexOf(word, start + word.length) !== -1) return <>{text} <mark>{word}</mark></>;
  return <>{text.slice(0, start)}<mark>{word}</mark>{text.slice(start + word.length)}</>;
}

function ChatAttachment({ context, promptOnly = false }) {
  const { japanese, translation, word } = context.data;
  const showMeaning = !promptOnly || context.promptLanguage !== "ja";
  return <div className="practice-chat__attachment">
    <div className="practice-chat__attachment-meta">
      <span className="practice-chat__clip" aria-hidden="true" />
      <span>{context.data.kind === "verb" ? "Verb" : "Subtitle"}</span>
      {Number.isFinite(context.time) && <time dateTime={`PT${context.time / 1000}S`}>{timestamp(context.time)}</time>}
    </div>
    <p lang="ja"><QuotedJapanese text={japanese} word={word?.surface} /></p>
    {showMeaning && translation && <p lang="en">{translation}</p>}
  </div>;
}

export function PracticeChat({ id, context, open, alternate, onSwitch, onClose, onAssist, completedAnswers = noAnswers }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const transcript = useRef(null);
  const field = useRef(null);
  const panel = useRef(null);
  const request = useRef(null);
  const dictionary = context.data.kind === "dictionary";
  const { word, question } = context.data;
  const greeting = word ? "Hey! Curious about this word? 🦊"
    : context.data.kind === "verb" ? "Hey! Want to practice this verb form? 🦊" : "Hey! Want to unpack this line? 🦊";
  const questions = question ? [...completedAnswers, question] : completedAnswers;
  const currentMessages = messages.filter(message => message.context?.id === context.id && message.role === "user");
  const locked = context.assisted && !currentMessages.some(message => message.assisted);
  const draftText = draft?.id === context.id ? draft?.text ?? "" : "";

  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    if (open) panel.current.focus({ preventScroll: true });
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const scroll = transcript.current;
    const latest = scroll.lastElementChild;
    scroll.scrollTop = Math.min(scroll.scrollHeight - scroll.clientHeight, latest.offsetTop);
  }, [open, messages, pending, completedAnswers, question]);

  async function send(event) {
    event.preventDefault();
    const content = draftText.trim();
    if (!content || request.current) return;
    const message = { role: "user", content, context, questionCount: questions.length };
    const controller = new AbortController();
    request.current = controller;
    setError(null);
    setPending(message);
    setDraft(null);
    const history = [...messages.slice(-8), message].map(({ role, content, context: messageContext }) => ({
      role, content, ...(dictionary && role === "user" && { word: messageContext.data.word }),
    }));
    try {
      const response = await fetch("/api/practice-chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: practiceChatRequest(context.data, history, completedAnswers),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.reply !== "string") {
        throw new Error(result?.error || "Yomiru couldn’t reply just now. Try again.");
      }
      if (!controller.signal.aborted) {
        const helped = result.assisted !== false;
        if (locked && helped) onAssist();
        setMessages(previous => [...previous, { ...message, assisted: !locked || helped },
          { role: "assistant", content: result.reply }]);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      setDraft({ id: context.id, text: content });
      setError({ id: context.id, text: failure.message === "Failed to fetch"
        ? "Yomiru couldn’t connect. Try again." : failure.message });
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function questionCards(start, end) {
    return questions.slice(start, end).map((answer, index) => {
      const number = start + index + 1;
      return <QuestionCard key={`question-${number}`} answer={answer} number={number} />;
    });
  }

  const visibleMessages = pending ? [...messages, pending] : messages;
  return <aside id={id} ref={panel} className="practice-chat" aria-label="Chat with Yomiru" tabIndex={-1} hidden={!open}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }}>
    {dictionary ? <button type="button" className="practice-chat__close" aria-label="Close chat" onClick={onClose}>
      <span aria-hidden="true">×</span>
    </button> : <button type="button" className="practice-chat__handle" aria-label="Close chat" onClick={onClose} />}
    <div ref={transcript} className="practice-chat__transcript" data-question-cards={Boolean(questions.length) || undefined}
      role="log" aria-label="Conversation">
      <ChatMessage role="assistant">{greeting}</ChatMessage>
      {[...visibleMessages.flatMap((message, index) => [
        ...(message.role === "user" ? questionCards(messages[index - 2]?.questionCount ?? 0, message.questionCount) : []),
        <ChatMessage key={`message-${index}`} role={message.role} attachment={!dictionary && index === 0 ? message.context : null}
          promptOnly={!message.assisted}>{message.content}</ChatMessage>,
      ]), ...questionCards(pending?.questionCount ?? messages.at(-2)?.questionCount ?? 0)]}
      {pending && <div className="practice-chat__message practice-chat__thinking" aria-hidden="true">
        <ChatAvatar />
        <div className="practice-chat__dots"><span /><span /><span /></div>
      </div>}
    </div>
    <span className="sr-only" role="status">{pending ? "Yomiru is thinking…" : ""}</span>
    <form className="practice-chat__form" onSubmit={send}>
      {alternate && <button type="button" className="practice-chat__switch" onClick={onSwitch}>{alternate}</button>}
      {!dictionary && !currentMessages.length && pending?.context.id !== context.id && <ChatAttachment context={context} promptOnly />}
      {locked && <p className="practice-chat__status">If Yomiru helps with this question, this turn won’t count toward mastery.</p>}
      {error?.id === context.id && error && <p className="practice-chat__status" role="alert">{error.text}</p>}
      <div className="practice-chat__composer">
        <textarea ref={field} rows={1} value={draftText} maxLength={maxQuestion} readOnly={Boolean(pending)}
          placeholder="Message Yomiru…" aria-label="Message Yomiru" onChange={event => setDraft({ id: context.id, text: event.target.value })}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form.requestSubmit();
          }} />
        <button type="submit" aria-label="Send message" disabled={!draftText.trim() || Boolean(pending)}
          onClick={() => field.current.focus({ preventScroll: true })}>
          <span aria-hidden="true" />
        </button>
      </div>
    </form>
  </aside>;
}
