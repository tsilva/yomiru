import { useEffect, useRef, useState } from "react";
import { heroCaptions, heroFrameAt } from "./hero-captions.mjs";

export function HeroSubtitles({ suspended = false }) {
  const [caption, setCaption] = useState(heroCaptions[0]);
  const [paused, setPaused] = useState(false);
  const elapsed = useRef(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer;
    let startedAt = null;

    function stop() {
      clearTimeout(timer);
      if (startedAt !== null) elapsed.current += performance.now() - startedAt;
      startedAt = null;
    }

    function tick() {
      const position = elapsed.current + (startedAt === null ? 0 : performance.now() - startedAt);
      const frame = heroFrameAt(reducedMotion.matches ? 0 : position);
      setCaption(frame.caption);
      if (startedAt !== null) timer = setTimeout(tick, frame.nextChange);
    }

    function resume() {
      stop();
      if (!paused && !suspended && !document.hidden && !reducedMotion.matches) startedAt = performance.now();
      tick();
    }

    resume();
    document.addEventListener("visibilitychange", resume);
    reducedMotion.addEventListener("change", resume);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", resume);
      reducedMotion.removeEventListener("change", resume);
    };
  }, [paused, suspended]);

  return <div className="hero__captions" role="group" aria-label="Subtitle preview" aria-live="off">
    <div className="hero__caption-lines" style={{ visibility: caption ? "visible" : "hidden" }}>
      <p className="hero__reading" lang="ja-Latn">{(caption || heroCaptions[0]).reading}</p>
      <p className="hero__meaning" lang="en">{(caption || heroCaptions[0]).meaning}</p>
    </div>
    <button className="hero__caption-toggle" type="button"
      aria-label={paused ? "Resume subtitle preview" : "Pause subtitle preview"}
      title={paused ? "Resume subtitle preview" : "Pause subtitle preview"}
      onClick={() => setPaused(value => !value)}>
      <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
    </button>
  </div>;
}
