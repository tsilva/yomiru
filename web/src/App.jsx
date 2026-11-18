import { useRef, useState } from "react";
import { SubtitleLibrary } from "./SubtitleLibrary.jsx";
import { HeroSubtitles } from "./HeroSubtitles.jsx";
import { DialogClose } from "./DialogClose.jsx";

export function App() {
  const installation = useRef(null);
  const installationTitle = useRef(null);
  const [installationOpen, setInstallationOpen] = useState(false);

  return (
    <>
      <div className="landing">
        <picture className="backdrop">
          <source media="(max-width: 900px)" srcSet="/assets/hero-portrait.webp?v=text-free" />
          <img
            className="hero__scene"
            src="/assets/hero.webp?v=text-free"
            alt="A woman reading on a bench in a sheltered seaside station courtyard at dusk."
            width="1966"
            height="800"
            fetchPriority="high"
          />
        </picture>
        <header className="landing__header">
          <div className="brand">
            <img className="brand__fox" src="/assets/fox.png" width="58" height="58" alt="" />
            <span className="brand__wordmark">
              <span>Yomiru</span>
              <span className="brand__reading" lang="ja">よみる</span>
            </span>
          </div>
          <a
            className="landing__github"
            href="https://github.com/tsilva/yomiru"
            aria-label="View Yomiru on GitHub"
            target="_blank"
            rel="noreferrer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.58 2 12.22c0 4.51 2.87 8.33 6.84 9.68.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.21-3.37-1.21-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.64-1.37-2.22-.26-4.56-1.15-4.56-5.1 0-1.13.39-2.05 1.04-2.78-.11-.26-.45-1.31.1-2.72 0 0 .85-.28 2.78 1.06A9.4 9.4 0 0 1 12 6.89c.85 0 1.71.12 2.51.36 1.93-1.34 2.78-1.06 2.78-1.06.55 1.41.21 2.46.1 2.72.65.73 1.04 1.65 1.04 2.78 0 3.96-2.35 4.84-4.59 5.09.36.32.69.94.69 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.24 10.24 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" />
            </svg>
          </a>
        </header>

        <main className="hero" aria-labelledby="hero-title">
          <div className="hero__content">
            <h1 id="hero-title">Japanese,<br />one episode at a time.</h1>
            <p>Learning subtitles for Stremio.</p>
            <button className="install" aria-haspopup="dialog" onClick={() => {
              installation.current.showModal();
              setInstallationOpen(true);
              installationTitle.current.focus();
            }}>
              <span className="install__face">Install in Stremio</span>
            </button>
            <a className="hero__browse" href="#subtitle-library">Browse subtitles</a>
          </div>
        </main>

        <HeroSubtitles suspended={installationOpen} />

        <dialog ref={installation} className="installation" aria-labelledby="installation-title" onClose={() => setInstallationOpen(false)}>
          <DialogClose label="Close installation instructions" />
          <div className="installation__content">
            <h2 ref={installationTitle} id="installation-title" tabIndex={-1}>Add Yomiru to Stremio.</h2>
            <ol className="installation__steps">
              <li>
                Click the button below to install the Yomiru add-on in Stremio, then confirm installation in the app.
                <a className="install installation__open" href="stremio://yomiru.tsilva.eu/manifest.json"><span className="install__face">Install in Stremio</span></a>
                <p className="installation__note">If the app does not open, paste <a href="https://yomiru.tsilva.eu/manifest.json">https://yomiru.tsilva.eu/manifest.json</a> into Stremio’s <strong>Addons → Add addon</strong> dialog.</p>
              </li>
              <li>Enable <strong>Settings → Player → Style ASS subtitles</strong> to see the Japanese learning line above its translation.</li>
              <li>Open a show or movie from your usual Stremio catalogue and choose a stream. Check <strong>Browse subtitles</strong> on the Yomiru website for coverage.</li>
              <li>In the player’s subtitle menu, choose one of the supported translation languages.</li>
              <li>Select a <strong>Yomiru</strong> subtitle track marked with <strong>🦊</strong> in your preferred reading mode, such as <strong>🦊 Romaji</strong>.</li>
            </ol>
          </div>
        </dialog>
      </div>
      <SubtitleLibrary />
    </>
  );
}
