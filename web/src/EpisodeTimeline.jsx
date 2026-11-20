function timestamp(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function EpisodeTimeline({ duration, time }) {
  const current = time == null ? "–:––" : timestamp(time);
  const total = timestamp(duration);

  return <div className="practice__timeline">
    <span className="practice__timeline-label">Episode</span>
    <strong className="practice__timeline-current" aria-hidden="true">{current}</strong>
    <progress className="mastery-bar" max={duration} value={time ?? 0} aria-label="Episode progress"
      aria-valuetext={`${current} of ${total}`} />
    <span aria-hidden="true">{total}</span>
  </div>;
}
