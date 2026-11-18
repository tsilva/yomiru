export function DialogClose({ label }) {
  return <form className="dialog-close" method="dialog">
    <button type="submit" aria-label={label} title="Close">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  </form>;
}
