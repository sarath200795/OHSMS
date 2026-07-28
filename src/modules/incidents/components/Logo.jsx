// Incident IRA logo — an original recreation of the "incident report" mark:
// a checklist document with a folded corner + an amber warning triangle.
// Drawn from primitives (no external/stock raster), so it scales and themes.
export default function Logo({ size = 32, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      {/* Document with folded top-right corner */}
      <path
        d="M12 6 H27 L34 13 V39 A3 3 0 0 1 31 42 H12 A3 3 0 0 1 9 39 V9 A3 3 0 0 1 12 6 Z"
        fill="#f5efe6" stroke="#5d4037" strokeWidth="2.4" strokeLinejoin="round"
      />
      <path d="M27 6 V13 H34" fill="none" stroke="#5d4037" strokeWidth="2.4" strokeLinejoin="round" />

      {/* Checklist rows with colored bullets */}
      <rect x="13.3" y="17.4" width="3.6" height="3.6" rx="0.9" fill="#f4b740" />
      <rect x="19" y="18" width="9.5" height="2.2" rx="1.1" fill="#5d4037" />
      <rect x="13.3" y="23.4" width="3.6" height="3.6" rx="0.9" fill="#c0492f" />
      <rect x="19" y="24" width="9.5" height="2.2" rx="1.1" fill="#5d4037" />
      <rect x="13.3" y="29.8" width="11" height="2.2" rx="1.1" fill="#5d4037" />

      {/* Warning triangle, overlapping bottom-right */}
      <path
        d="M33 23.6 L44 41.4 A1.8 1.8 0 0 1 42.4 44 H23.6 A1.8 1.8 0 0 1 22 41.4 Z"
        fill="#f4a93a" stroke="#5d4037" strokeWidth="2.4" strokeLinejoin="round"
      />
      <rect x="31.7" y="30.4" width="2.6" height="6.2" rx="1.3" fill="#4e342e" />
      <circle cx="33" cy="40.2" r="1.55" fill="#4e342e" />
    </svg>
  )
}
