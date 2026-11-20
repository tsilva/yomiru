export function isMobileDisplay(browser) {
  const { userAgent, userAgentData, maxTouchPoints } = browser.navigator;
  return Boolean(userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/.test(userAgent)
    || (userAgent.includes("Macintosh") && maxTouchPoints > 1)
    || browser.matchMedia("(pointer: coarse) and (hover: none)").matches);
}

export function isLandscape(browser, viewport) {
  const type = browser.screen.orientation?.type;
  if (type) return type.startsWith("landscape");
  if (typeof browser.orientation === "number") return Math.abs(browser.orientation) % 180 === 90;
  return viewport.matches;
}

export function startMobilePracticeFullscreen(browser = window) {
  const { document } = browser;
  const root = document.documentElement;
  if (!isMobileDisplay(browser) || document.fullscreenElement || !root.requestFullscreen) return;

  let closed = false;
  let ownsFullscreen = false;
  function release() {
    if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
  }
  function loseFullscreen() {
    if (document.fullscreenElement !== root) ownsFullscreen = false;
  }

  // Request synchronously from the Exercise click before entering the lazy-loaded quiz.
  void root.requestFullscreen({ navigationUI: "hide" }).then(() => {
    if (document.fullscreenElement !== root) return;
    if (closed) {
      release();
      return;
    }
    ownsFullscreen = true;
    document.addEventListener("fullscreenchange", loseFullscreen);
    void browser.screen.orientation?.lock?.("portrait")?.catch(() => {});
  }).catch(() => {});

  return () => {
    closed = true;
    document.removeEventListener("fullscreenchange", loseFullscreen);
    if (ownsFullscreen) release();
    ownsFullscreen = false;
  };
}
