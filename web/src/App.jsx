import { useRef } from "react";
import { SubtitleLibrary } from "./SubtitleLibrary.jsx";

export function App() {
  const installation = useRef(null);

  return (
    <>
      <div className="landing">
        <picture className="backdrop">
          <source media="(max-width: 900px)" srcSet="/assets/hero-portrait.webp?v=peaceful-here-ne" />
          <img
            className="hero__scene"
            src="/assets/hero.webp?v=peaceful-here-ne"
            alt="A woman reading on a bench in a sheltered seaside station courtyard at dusk. Japanese reading: Koko wa ochitsuku ne. English: It’s peaceful here, isn’t it?"
            width="1966"
            height="800"
            fetchPriority="high"
          />
        </picture>
        <header className="brand" aria-label="Yomiru">
          <img className="brand__fox" src="/assets/fox.png" width="58" height="58" alt="" />
          <span className="brand__wordmark">
            <span>Yomiru</span>
            <span className="brand__reading" lang="ja">よみる</span>
          </span>
        </header>

        <main className="hero" aria-labelledby="hero-title">
          <div className="hero__content">
            <h1 id="hero-title">Japanese,<br />one episode at a time.</h1>
            <p>Learning subtitles for Stremio.</p>
            <a className="install" href="stremio://yomiru.tsilva.eu/manifest.json">
              <span className="install__face">Install in Stremio</span>
            </a>
            <a className="hero__browse" href="#subtitle-library">Browse subtitles</a>
            <button className="hero__help" onClick={() => installation.current.showModal()}>
              Installation help
            </button>
          </div>
        </main>

        <dialog ref={installation} className="installation" aria-labelledby="installation-title">
          <form method="dialog">
            <button className="installation__close" aria-label="Close installation instructions">Close</button>
          </form>
          <h2 id="installation-title">Add Yomiru to Stremio.</h2>
          <p>Confirm installation in Stremio, then choose a Yomiru track in the subtitle picker on a supported episode.</p>
          <p>Enable <strong>Style ASS subtitles</strong> in the player settings to see the Japanese learning line above its English meaning.</p>
          <a className="install installation__open" href="stremio://yomiru.tsilva.eu/manifest.json"><span className="install__face">Open Stremio</span></a>
          <p className="installation__note">Or paste <a href="https://yomiru.tsilva.eu/manifest.json">https://yomiru.tsilva.eu/manifest.json</a> into Stremio’s <strong>Addons → Add addon</strong> dialog. Coverage is growing; check timing against your video release.</p>
        </dialog>
      </div>
      <SubtitleLibrary />
    </>
  );
}
