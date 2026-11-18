import { useEffect, useState } from "react";
import "./compatibility.css";

const ratingOptions = [1, 2, 3, 4, 5];

function anonymousVoter() {
  const key = "yomiru-feedback-browser-v1";
  let value = localStorage.getItem(key);
  if (!/^[a-f0-9]{64}$/.test(value || "")) {
    value = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, value);
  }
  return value;
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) return;
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error || "Feedback is temporarily unavailable. Try again.");
  return body;
}

export function Compatibility() {
  const [code] = useState(() => new URLSearchParams(location.search).get("feedback"));
  const [voter] = useState(() => {
    if (!code) return null;
    try { return anonymousVoter(); } catch { return null; }
  });
  const [episode, setEpisode] = useState(null);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const url = `/api/feedback?form=1&code=${encodeURIComponent(code)}`;

  useEffect(() => {
    document.title = "Subtitle feedback · Yomiru";
    if (!code) return;
    const controller = new AbortController();
    setError("");
    request(url, {
      signal: controller.signal,
      headers: voter ? { "X-Yomiru-Voter": voter } : {},
    }).then(data => {
      setEpisode(data);
      setStars(data.rating?.stars ?? 0);
      setComment(data.rating?.comment ?? "");
    }).catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => controller.abort();
  }, [code, voter, url, reload]);

  async function submit(event) {
    event.preventDefault();
    if (!stars || !voter || pending) return;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, comment, voter }),
      });
      setSaved(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setPending(false);
    }
  }

  return <main className="subtitle-feedback">
    <div className="subtitle-feedback__content">
      <a className="subtitle-feedback__brand" href="/">
        <img src="/assets/fox.png" width="44" height="44" alt="" />Yomiru
      </a>
      {!episode && <>
        <h1>Subtitle feedback</h1>
        {!code && <p>Open the feedback link shown in your Yomiru subtitles.</p>}
        {code && !error && <p role="status">Loading feedback…</p>}
        {error && <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setReload(count => count + 1)}>Try again</button>
        </div>}
      </>}
      {episode && <>
        <h1>{episode.title}</h1>
        {episode.detail && <p className="subtitle-feedback__episode">{episode.detail}</p>}
        <p className="subtitle-feedback__track">Subtitles: {episode.subtitles}</p>
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend>Rate the subtitles</legend>
            <div className="subtitle-feedback__stars" onPointerLeave={() => setHover(0)}>
              {ratingOptions.map(value => <label key={value} onPointerEnter={event => {
                if (event.pointerType === "mouse" && !pending) setHover(value);
              }}>
                <input type="radio" name="stars" value={value} aria-label={value === 1 ? "1 star" : `${value} stars`}
                  checked={stars === value} onChange={() => { setStars(value); setSaved(false); }} required />
                <span aria-hidden="true" className={value <= (hover || stars) ? "is-filled" : undefined} />
              </label>)}
            </div>
          </fieldset>
          <label className="subtitle-feedback__comment" htmlFor="feedback-comment">Comment (optional)</label>
          <textarea id="feedback-comment" value={comment} maxLength={1000} disabled={pending}
            onChange={event => { setComment(event.target.value); setSaved(false); }} />
          <button type="submit" disabled={!voter || !stars || pending}>
            {pending ? "Sending…" : "Submit feedback"}
          </button>
          {error && <p className="subtitle-feedback__error" role="alert">{error}</p>}
          <p className="subtitle-feedback__status" role="status">
            {!voter ? "Enable browser storage to submit feedback." : saved ? "Feedback saved." : ""}
          </p>
        </form>
      </>}
    </div>
  </main>;
}
