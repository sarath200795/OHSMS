/**
 * Committee-meeting mark — a group seated around a round table with discussion
 * bubbles above. Single-color glyph using `currentColor`, so set the colour via
 * a text-* class (e.g. text-white on a green tile, or text-brand-600).
 */
export default function Logo({ size = 24, className = '' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* discussion bubbles (callouts) */}
      <path fill="#facc15" d="M25 4c-7.2 0-13 4.2-13 9.4 0 3 1.9 5.6 4.9 7.3-.5 1.6-1.5 3-3 4.2 2.7-.2 5-1 6.9-2.3 1.3.3 2.7.5 4.2.5 7.2 0 13-4.2 13-9.7C38 8.2 32.2 4 25 4z" />
      <path fill="#ef4444" d="M46 15.5c-5 0-9 3-9 6.8 0 2 1.1 3.8 3 5-.4 1.2-1.1 2.2-2.1 3 1.9-.1 3.5-.7 4.8-1.7.9.2 1.9.3 3 .3 5 0 9-3 9-6.7s-4-6.7-9-6.7z" />

      {/* back row of seated people */}
      <circle cx="32" cy="33" r="5.2" />
      <circle cx="19" cy="35.5" r="4.4" />
      <circle cx="45" cy="35.5" r="4.4" />
      <circle cx="9.5" cy="39.5" r="3.9" />
      <circle cx="54.5" cy="39.5" r="3.9" />
      <path d="M23.5 45a8.5 8.5 0 0 1 17 0z" />
      <path d="M11.5 47.5a7.4 7.4 0 0 1 14.8 0z" />
      <path d="M37.7 47.5a7.4 7.4 0 0 1 14.8 0z" />
      <path d="M2.6 51a7 7 0 0 1 14 0z" />
      <path d="M47.4 51a7 7 0 0 1 14 0z" />

      {/* round meeting table (drawn over the lower bodies) */}
      <path d="M6 47.5c7.5 6.7 16.4 9.8 26 9.8s18.5-3.1 26-9.8c1.5 2.9 1.5 5.8 0 7.8-7.2 6-16.6 8.9-26 8.9s-18.8-2.9-26-8.9c-1.5-2-1.5-4.9 0-7.8z" />

      {/* foreground chairperson */}
      <circle cx="32" cy="43.5" r="6.3" />
      <rect x="24.3" y="50.5" width="15.4" height="12.5" rx="3.2" />
    </svg>
  )
}
