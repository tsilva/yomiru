import { useEffect, useRef, useState } from "react";
import { analyticsStorageKey, googleAnalytics } from "./analytics.mjs";
import "./analytics.css";

export function AnalyticsSettings({ measurementId }) {
  const details = useRef(null);
  const summary = useRef(null);
  const consent = useRef(null);
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    consent.current ??= googleAnalytics(measurementId);
    let saved;
    try { saved = localStorage.getItem(analyticsStorageKey); }
    catch { /* Keep the default when storage is unavailable. */ }
    setChoice(saved);
    consent.current(saved === "allow");
    details.current.open = saved !== "allow" && saved !== "decline";

    function syncChoice(event) {
      if (event.key === analyticsStorageKey || event.key === null) {
        setChoice(event.newValue);
        consent.current(event.newValue === "allow");
      }
    }
    window.addEventListener("storage", syncChoice);
    return () => window.removeEventListener("storage", syncChoice);
  }, [measurementId]);

  function choose(nextChoice) {
    try { localStorage.setItem(analyticsStorageKey, nextChoice); }
    catch { /* The choice still applies to this page. */ }
    setChoice(nextChoice);
    consent.current?.(nextChoice === "allow");
    details.current.open = false;
    summary.current.focus();
  }

  return <details className="analytics-settings" ref={details}>
    <summary ref={summary}>Analytics settings</summary>
    <p>Allow Google Analytics to measure visits to Yomiru?</p>
    <div className="analytics-settings__actions">
      <button type="button" aria-pressed={choice === "decline"} onClick={() => choose("decline")}>Decline</button>
      <button type="button" aria-pressed={choice === "allow"} onClick={() => choose("allow")}>Allow analytics</button>
    </div>
  </details>;
}
