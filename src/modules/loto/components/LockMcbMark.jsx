// LOTO emblem: a padlock with a hanging DANGER tag. The padlock fills with
// currentColor (so it reads as dark ink on the yellow brand tile); the keyhole
// is cut in the tile color, and the tag is a small white card with a red header
// — echoing the "DO NOT OPERATE" tag used on isolation points.
export default function LockMcbMark({ size = 28, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* padlock shackle */}
      <path
        d="M5 11V9a2.8 2.8 0 0 1 5.6 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* padlock body */}
      <rect x="2.5" y="11" width="10.6" height="9.5" rx="2.3" fill="currentColor" />
      {/* keyhole (cut in the tile color) */}
      <circle cx="7.8" cy="15.2" r="1.3" fill="#ffcc1a" />
      <rect x="7.1" y="15.2" width="1.4" height="3.4" rx="0.7" fill="#ffcc1a" />

      {/* string to the tag */}
      <path d="M10.4 9.2c3 .4 4.2 1.6 5 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* DANGER tag — white card with a red header */}
      <rect x="14" y="11.6" width="7.6" height="9" rx="1.5" fill="#fff" stroke="currentColor" strokeWidth="0.8" />
      <path d="M14 14.6v-1.5a1.5 1.5 0 0 1 1.5-1.5h4.6a1.5 1.5 0 0 1 1.5 1.5v1.5z" fill="#e5484d" />
      <rect x="15.4" y="16.4" width="4.8" height="0.9" rx="0.45" fill="currentColor" />
      <rect x="15.4" y="18.1" width="4.8" height="0.9" rx="0.45" fill="currentColor" />
    </svg>
  )
}
