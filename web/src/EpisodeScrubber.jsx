import { useRef, useState } from "react";
import { episodeStopAt } from "./vocabulary-quiz.mjs";

function timestamp(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function EpisodeScrubber({ timeline: { duration, stops }, time, blocked, onJump }) {
  const [preview, setPreview] = useState(null);
  const pointer = useRef(null);
  const current = time == null ? "–:––" : timestamp(time);
  const total = timestamp(duration);
  const target = !blocked && preview;
  const percent = value => `${100 * value / duration}%`;

  function position(event) {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - left) / width)) * duration;
  }

  function updatePreview(event) {
    if (!blocked && (event.pointerType !== "touch" || pointer.current === event.pointerId)) {
      setPreview(episodeStopAt(stops, position(event)));
    }
  }

  function start(event) {
    if (blocked || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    updatePreview(event);
  }

  function end(event) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setPreview(null);
    if (!blocked) onJump(episodeStopAt(stops, position(event)), true);
  }

  function cancel(event) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setPreview(null);
  }

  function keyboard(event) {
    const at = time ?? 0;
    let stop;
    switch (event.key) {
      case "Home": stop = stops[0]; break;
      case "End": stop = stops.at(-1); break;
      case "ArrowLeft": case "ArrowDown": stop = stops.findLast(([start]) => start < at); break;
      case "ArrowRight": case "ArrowUp": stop = stops.find(([start]) => start > at); break;
      case "PageUp": stop = episodeStopAt(stops, at + duration / 10); break;
      case "PageDown": stop = episodeStopAt(stops, at - duration / 10); break;
      default: return;
    }
    event.preventDefault();
    setPreview(null);
    if (!blocked && stop) onJump(stop);
  }

  return <div className="practice__timeline">
    <span className="practice__timeline-label">Episode</span>
    <strong className="practice__timeline-current" aria-hidden="true">{current}</strong>
    <div className="practice__scrubber" style={{ "--episode-position": percent(time ?? 0) }}>
      <div className="practice__scrubber-track" aria-hidden="true" />
      <input type="range" min="0" max={duration} step="1" value={time ?? 0} aria-label="Episode position"
        aria-valuetext={`${current} of ${total}`} aria-disabled={blocked || undefined} onKeyDown={keyboard}
        onChange={event => {
          if (!blocked && pointer.current === null) onJump(episodeStopAt(stops, Number(event.target.value)));
        }}
        onPointerDown={start} onPointerMove={updatePreview} onPointerUp={end}
        onPointerCancel={cancel} onLostPointerCapture={cancel}
        onPointerLeave={() => { if (pointer.current === null) setPreview(null); }} />
      {target && <div className="practice__scrubber-preview" aria-hidden="true"
        style={{ "--episode-preview": percent(target[0]) }}>
        <span>Jump to {timestamp(target[0])}</span>
      </div>}
    </div>
    <span className="practice__timeline-duration" aria-hidden="true">{total}</span>
  </div>;
}
