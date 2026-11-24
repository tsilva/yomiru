import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { timestamp } from "./EpisodeTimeline.jsx";
import { formatPracticeReply } from "./practice-chat-format.mjs";
import fox from "./practice-chat-fox.webp";
import student from "./practice-chat-student.webp";
import "./practice-chat.css";

const maxQuestion = 1200;

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

function QuotedJapanese({ text, word }) {
  if (!word) return text;
  const start = text.indexOf(word);
  if (start < 0 || text.indexOf(word, start + word.length) !== -1) return <>{text} <mark>{word}</mark></>;
  return <>{text.slice(0, start)}<mark>{word}</mark>{text.slice(start + word.length)}</>;
}

function ChatAttachment({ context, promptOnly = false }) {
  const { kind, japanese, translation, word } = context.data;
  const dictionary = kind === "dictionary";
  const showJapanese = !promptOnly || context.promptLanguage !== "en";
  const showMeaning = !promptOnly || context.promptLanguage !== "ja";
  return <div className="practice-chat__attachment">
    <div className="practice-chat__attachment-meta">
      <span className="practice-chat__clip" aria-hidden="true" />
      <span>{dictionary ? "Dictionary word" : "Subtitle"}</span>
      {Number.isFinite(context.time) && <time dateTime={`PT${context.time / 1000}S`}>{timestamp(context.time)}</time>}
    </div>
    {dictionary ? <>
      {showJapanese && <>
        <p lang="ja"><strong>{word.surface}</strong>{word.reading !== word.surface && <> · {word.reading}</>}</p>
        {word.romaji && <p lang="ja-Latn">{word.romaji}</p>}
      </>}
      {showMeaning && word.meaning && <p lang="en">{word.meaning}</p>}
    </> : <>
      <p lang="ja"><QuotedJapanese text={japanese} word={word?.surface} /></p>
      {translation && <p lang="en">{translation}</p>}
    </>}
  </div>;
}

export function PracticeChat({ id, context, open, alternate, onSwitch, onClose, onAssist }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const transcript = useRef(null);
  const field = useRef(null);
  const panel = useRef(null);
  const request = useRef(null);
  const locked = context.assisted && !messages.length;

  useEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    if (open) panel.current.focus({ preventScroll: true });
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const scroll = transcript.current;
    const latest = scroll.lastElementChild;
    scroll.scrollTop = Math.min(scroll.scrollHeight - scroll.clientHeight, latest.offsetTop);
  }, [open, messages, pending]);

  async function send(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || request.current) return;
    const message = { role: "user", content };
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setPending(content);
    setDraft("");
    try {
      const response = await fetch("/api/practice-chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ context: context.data, messages: [...messages.slice(-8), message] }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.reply !== "string") {
        throw new Error(result?.error || "Yomiru couldn’t reply just now. Try again.");
      }
      if (!controller.signal.aborted) {
        if (locked) onAssist();
        setMessages(previous => [...previous, message, { role: "assistant", content: result.reply }]);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      setDraft(content);
      setError(failure.message === "Failed to fetch" ? "Yomiru couldn’t connect. Try again." : failure.message);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending("");
    }
  }

  const { word } = context.data;
  return <aside id={id} ref={panel} className="practice-chat" aria-label="Chat with Yomiru" tabIndex={-1} hidden={!open}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }}>
    <button type="button" className="practice-chat__handle" aria-label="Close chat" onClick={onClose} />
    <div ref={transcript} className="practice-chat__transcript" role="log" aria-label="Conversation">
      <ChatMessage role="assistant">{word ? "Hey! Curious about this word? 🦊" : "Hey! Want to unpack this line? 🦊"}</ChatMessage>
      {messages.map((message, index) => <ChatMessage key={index} role={message.role}
        attachment={index === 0 ? context : null}>{message.content}</ChatMessage>)}
      {pending && <ChatMessage role="user" attachment={!messages.length ? context : null} promptOnly>{pending}</ChatMessage>}
      {pending && <div className="practice-chat__message practice-chat__thinking" aria-hidden="true">
        <ChatAvatar />
        <div className="practice-chat__dots"><span /><span /><span /></div>
      </div>}
    </div>
    <span className="sr-only" role="status">{pending ? "Yomiru is thinking…" : ""}</span>
    <form className="practice-chat__form" onSubmit={send}>
      {alternate && <button type="button" className="practice-chat__switch" onClick={onSwitch}>{alternate}</button>}
      {!messages.length && !pending && <ChatAttachment context={context} promptOnly />}
      {locked && <p className="practice-chat__status">If Yomiru helps with this question, this turn won’t count toward mastery.</p>}
      {error && <p className="practice-chat__status" role="alert">{error}</p>}
      <div className="practice-chat__composer">
        <textarea ref={field} rows={1} value={draft} maxLength={maxQuestion} readOnly={Boolean(pending)}
          placeholder="Message Yomiru…" aria-label="Message Yomiru" onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form.requestSubmit();
          }} />
        <button type="submit" aria-label="Send message" disabled={!draft.trim() || Boolean(pending)}
          onClick={() => field.current.focus({ preventScroll: true })}>
          <span aria-hidden="true" />
        </button>
      </div>
    </form>
  </aside>;
}
