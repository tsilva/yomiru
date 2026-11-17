import { useEffect, useRef, useState } from "react";
import "./subtitle-library.css";

function LibraryRows({ search }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const bottom = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setError("");
    const query = new URLSearchParams({ search });
    if (cursor) query.set("cursor", cursor);
    fetch(`/api/browse?${query}`, { signal: controller.signal }).then(async response => {
      if (response.status === 409 && cursor) {
        if (active) { setRows([]); setNextCursor(null); setCursor(""); }
        return;
      }
      if (!response.ok) throw new Error("The subtitle library is temporarily unavailable.");
      const page = await response.json();
      if (!Array.isArray(page.rows) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) {
        throw new Error("The subtitle library is temporarily unavailable.");
      }
      if (!active) return;
      setRows(previous => cursor ? [...previous, ...page.rows] : page.rows);
      setNextCursor(page.nextCursor);
    }).catch(error => {
      if (active && error.name !== "AbortError") setError(error.message);
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); };
  }, [search, cursor, retry]);

  useEffect(() => {
    if (pending || error || !nextCursor || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setCursor(nextCursor);
    }, { rootMargin: "0px 0px 240px 0px" });
    observer.observe(bottom.current);
    return () => observer.disconnect();
  }, [pending, error, nextCursor]);

  return <>
    <div className="subtitle-library__scroll" tabIndex={0} role="region" aria-label="Available subtitle episodes">
      <table className="subtitle-library__table" aria-label="Subtitle library" aria-busy={pending}>
        <thead><tr>
          <th scope="col">Show</th><th scope="col">Season</th><th scope="col">Episode</th>
          <th scope="col">Translations</th><th scope="col"><span className="sr-only">Open episode</span></th>
        </tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.show}</th>
          <td>{row.season}</td>
          <td>{String(row.episode).padStart(2, "0")} · {row.title}</td>
          <td>{row.translations.map(language => language.label).join(" · ")}</td>
          <td><a href={row.stremioUrl} aria-label={`Open ${row.show}, season ${row.season}, episode ${row.episode} in Stremio`}>Open in Stremio</a></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="subtitle-library__status" ref={bottom} aria-live="polite">
      {pending ? <p>Loading subtitles…</p> : error ? <p role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></p>
        : !rows.length ? <p>{search ? "No subtitles match your search." : "No episodes have been published yet."}</p>
          : nextCursor ? <button onClick={() => setCursor(nextCursor)}>Load more episodes</button> : null}
    </div>
  </>;
}

export function SubtitleLibrary() {
  const [value, setValue] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);

  return <section id="subtitle-library" className="subtitle-library" aria-labelledby="library-title" tabIndex={-1}>
    <h2 id="library-title">Subtitle library</h2>
    <label className="sr-only" htmlFor="library-search">Search shows or episodes</label>
    <input id="library-search" className="subtitle-library__search" type="search" value={value}
      maxLength={200} placeholder="Search shows or episodes…" autoComplete="off"
      onChange={event => setValue(event.target.value)} />
    <LibraryRows key={search} search={search} />
  </section>;
}
