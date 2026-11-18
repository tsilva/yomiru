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
