// tiny brand lockup, pure svg so no extra request. mark = letter A cut into an ink tile
export default function Wordmark({ big = false }: { big?: boolean }) {
  return (
    <span className={`wordmark${big ? " big" : ""}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" fill="var(--primary)" />
        <path d="M9.5 23 16 8.5 22.5 23M12 18.5h8" fill="none" stroke="var(--primary-text)" strokeWidth="2.4" strokeLinecap="square" />
      </svg>
      <span className="wordmark-text">Ajaia <span>Docs</span></span>
    </span>
  );
}
