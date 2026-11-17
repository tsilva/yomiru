import { useEffect, useState } from "react";
import "./compatibility.css";

function anonymousVoter() {
  const key = "yomiru-feedback-browser-v1";
  let value = localStorage.getItem(key);
  if (!/^[a-f0-9]{64}$/.test(value || "")) {
    value = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, value);
  }
  return value;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load source feedback.");
  return body;
}

export function Compatibility() {
  const [feedback] = useState(() => new URLSearchParams(location.search).get("feedback"));
  const [episodes, setEpisodes] = useState([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState(null);
  const [voter, setVoter] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [filter, setFilter] = useState("all");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    document.title = "Subtitle sources · Yomiru";
    const controller = new AbortController();
    try { setVoter(anonymousVoter()); }
    catch { setNotice("Enable browser storage to save a vote. You can still browse source reports."); }
    request(feedback ? `/api/compatibility?feedback=${encodeURIComponent(feedback)}` : "/api/compatibility", { signal: controller.signal }).then(result => {
      if (feedback) {
        setEpisodes([result.episode]); setSelected(`${result.episode.type}/${result.episode.id}`); return;
      }
      setEpisodes(result.episodes);
      const query = new URLSearchParams(location.search);
      const target = result.episodes.find(e => e.id === query.get("id") && e.type === (query.get("type") || "series"))
        || result.episodes.find(e => e.showId === query.get("show")) || result.episodes[0];
      if (target) setSelected(`${target.type}/${target.id}`);
    }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [feedback]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const [type, id] = selected.split("/");
    setData(null); setError("");
    request(`/api/compatibility?type=${type}&id=${encodeURIComponent(id)}${feedback ? `&feedback=${encodeURIComponent(feedback)}` : ""}`, {
      headers: voter ? { "X-Yomiru-Voter": voter } : {}, signal: controller.signal,
    }).then(setData).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [selected, voter, reload, feedback]);

  async function vote(group, release, works) {
    if (!voter || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await request("/api/compatibility", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: group.type, id: group.videoId, groupId: group.id,
          releaseId: release.id, voter, works, ...(feedback ? { feedback } : {}) }),
      });
      setData(next); setNotice("Your vote is saved. You can change it using the other button.");
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }

  const allReleases = data?.groups.flatMap(group => group.releases) || [];
  const unrated = allReleases.filter(release => !release.total).length;

  return <div className="compatibility">
    <header className="compatibility__header">
      <a href="/" aria-label="Yomiru home"><img src="/assets/fox.png" alt="" width="40" height="40" /><span>Yomiru</span></a>
      <span>Subtitle sources</span>
    </header>
    <main className="compatibility__main">
      <h1>Does it work with your video?</h1>
      <p className="compatibility__intro">Video versions seen in Stremio, with feedback from viewers. A request tells us a source was seen—it doesn’t confirm playback or subtitle selection.</p>
      <div className="compatibility__controls">
        <label htmlFor="episode">Episode</label>
        <select id="episode" value={selected} disabled={pending || !episodes.length || Boolean(feedback)} onChange={event => {
          setSelected(event.target.value); setNotice("");
          const [type, id] = event.target.value.split("/");
          history.replaceState(null, "", `/compatibility?type=${type}&id=${encodeURIComponent(id)}`);
        }}>
          {!episodes.length && <option>Loading episodes…</option>}
          {episodes.map(e => <option key={`${e.type}/${e.id}`} value={`${e.type}/${e.id}`}>{e.title}</option>)}
        </select>
      </div>
      {data && <div className="compatibility__toolbar">
        <p>{allReleases.length} video version{allReleases.length === 1 ? "" : "s"} seen · {unrated} unrated</p>
        <label><input type="checkbox" checked={filter === "unrated"} onChange={e => setFilter(e.target.checked ? "unrated" : "all")} /> Only unrated</label>
      </div>}
      {error && <div className="compatibility__error" role="alert">{error} <button onClick={() => selected ? setReload(n => n + 1) : location.reload()}>Try again</button></div>}
      <p className="compatibility__notice" role="status">{notice}</p>
      {!data && !error && <p aria-live="polite">Loading source reports…</p>}
      {data?.groups.map(group => <section className="compatibility__group" key={group.id} aria-label={group.source}>
        <h2>{group.source}</h2>
        <p className="compatibility__revision">Subtitle revision {group.id.slice(0, 8)} · {group.lang.toUpperCase()} meaning · all reading modes</p>
        {!group.releases.length && <p className="compatibility__empty">No video versions seen yet. Open this episode in Stremio; it will appear here if Stremio supplies a video filename or hash. Earlier sessions cannot be reconstructed.</p>}
        {group.releases.length > 0 && filter === "unrated" && group.releases.every(r => r.total) && <p className="compatibility__empty">Every source has feedback. Uncheck “Only unrated” to see the results.</p>}
        {group.releases.filter(r => filter !== "unrated" || !r.total).map(release => <article className="compatibility__release" key={release.id}>
          <div className="compatibility__source">
            <h3>{release.filename || `Video hash ${release.videoHash}`}</h3>
            <p>{release.match}{release.videoSize ? ` · ${release.videoSize.toLocaleString()} bytes` : ""} · seen {new Date(release.lastSeen).toLocaleDateString()}</p>
            {release.filenames.length > 1 && <details><summary>{release.filenames.length} filenames seen for this file</summary><ul>{release.filenames.map(name => <li key={name}>{name}</li>)}</ul></details>}
          </div>
          <div className="compatibility__result">
            <strong>{release.total ? `${release.percentWorks}% works` : "Unrated"}</strong>
            <span>{release.total ? `${release.works} works · ${release.doesntWork} doesn’t work` : "No confirmations yet"}</span>
          </div>
          <div className="compatibility__vote" role="group" aria-label={`Your experience with ${release.filename || release.videoHash}`}>
            <button disabled={!voter || pending} aria-pressed={release.myVote === true} onClick={() => vote(group, release, true)}>Works</button>
            <button disabled={!voter || pending} aria-pressed={release.myVote === false} onClick={() => vote(group, release, false)}>Doesn’t work</button>
          </div>
        </article>)}
      </section>)}
      <p className="compatibility__footnote">Vote after trying this subtitle revision with the exact video shown. Results pool anonymous browser votes, not verified synchronization. One vote per browser and video/subtitle revision; clearing browser storage or using another device allows another vote.</p>
    </main>
  </div>;
}
