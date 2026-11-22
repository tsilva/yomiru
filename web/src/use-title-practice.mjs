import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { startMobilePracticeFullscreen } from "./mobile-display.mjs";
import { loadPracticeTitle, parsePracticePath, unsupportedPracticeMessage } from "./practice-route.mjs";

function readEntry() {
  const route = parsePracticePath(window.location.pathname);
  return route ? { route } : null;
}

export function useTitlePractice() {
  const [entry, setEntry] = useState(readEntry);
  const [resolution, setResolution] = useState(null);
  const endFullscreen = entry?.endFullscreen;
  useEffect(() => endFullscreen, [endFullscreen]);

  const updateFromHistory = useEffectEvent(() => {
    const next = readEntry();
    if (next?.route.pathname === entry?.route.pathname) return;
    setEntry(next);
    if (!next && entry?.trigger) {
      requestAnimationFrame(() => entry.trigger.focus({ preventScroll: true }));
    }
  });
  useEffect(() => {
    const onPopState = () => updateFromHistory();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!entry || entry.publication) return;
    const controller = new AbortController();
    const { signal } = controller;
    loadPracticeTitle(entry.route, { signal }).then(result => {
      if (!signal.aborted) setResolution({ entry, ...result });
    }).catch(() => {
      if (!signal.aborted) setResolution({ entry, error: "The subtitle library is temporarily unavailable." });
    });
    return () => controller.abort();
  }, [entry]);

  const retry = useCallback(() => setEntry(current => current && { ...current, publication: undefined }), []);
  const current = resolution?.entry === entry ? resolution : null;
  const unsupported = Boolean(current && !current.error && current.title?.practiceSupported !== true);
  return {
    id: entry?.route.id,
    title: current?.title ?? entry?.title,
    publication: entry?.publication ?? (current?.title?.practiceSupported === true ? current.publication : ""),
    error: current?.error ?? (unsupported ? unsupportedPracticeMessage(current.title) : undefined),
    unsupported,
    retry: unsupported ? undefined : retry,
    open(pathname, title, publication, trigger) {
      if (title.practiceSupported !== true) return;
      window.history.pushState({ yomiruPractice: pathname }, "", pathname);
      setEntry({ route: parsePracticePath(pathname), title, publication, trigger,
        endFullscreen: startMobilePracticeFullscreen() });
    },
    close() {
      if (window.history.state?.yomiruPractice === entry.route.pathname) {
        window.history.back();
        return;
      }
      window.history.replaceState(null, "", "/#subtitle-library");
      setEntry(null);
      requestAnimationFrame(() => document.getElementById("subtitle-library")?.focus());
    },
  };
}
