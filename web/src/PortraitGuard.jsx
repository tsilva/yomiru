import { useLayoutEffect, useRef } from "react";
import { isLandscape, isMobileDisplay } from "./mobile-display.mjs";

export function PortraitGuard() {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  useLayoutEffect(() => {
    if (!isMobileDisplay(window)) return;
    const dialog = dialogRef.current;
    const screenOrientation = window.screen.orientation;
    const viewport = window.matchMedia("(orientation: landscape)");
    function showPrompt() {
      dialog.showModal();
      titleRef.current.focus({ preventScroll: true });
    }
    const observer = new MutationObserver(records => {
      // A dialog can finish loading after the screen rotates. Keep it behind the prompt.
      if (dialog.open && records.some(({ target }) => target !== dialog && target.matches("dialog[open]"))) {
        dialog.close();
        showPrompt();
      }
    });
    function update() {
      if (isLandscape(window, viewport)) {
        if (!dialog.open) {
          showPrompt();
          observer.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
        }
      } else {
        observer.disconnect();
        if (dialog.open) dialog.close();
      }
    }
    screenOrientation?.addEventListener?.("change", update);
    window.addEventListener("orientationchange", update);
    viewport.addEventListener("change", update);
    update();
    return () => {
      screenOrientation?.removeEventListener?.("change", update);
      window.removeEventListener("orientationchange", update);
      viewport.removeEventListener("change", update);
      observer.disconnect();
      if (dialog.open) dialog.close();
    };
  }, []);

  return <dialog className="portrait-guard" ref={dialogRef} aria-labelledby="portrait-guard-title"
    aria-describedby="portrait-guard-direction"
    onCancel={event => event.preventDefault()}>
    <div>
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect x="24" y="24" width="22" height="34" rx="5" transform="rotate(-25 35 41)" />
        <path d="m24 29 16-7M35 54l5-2M13 34a22 22 0 0 1 30-22m-1-7 3 9-9 1" />
      </svg>
      <h1 id="portrait-guard-title" tabIndex={-1} ref={titleRef}>Rotate your device</h1>
      <p id="portrait-guard-direction">Turn it upright to continue.</p>
    </div>
  </dialog>;
}
