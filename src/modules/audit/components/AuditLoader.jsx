/**
 * Themed loading graphic: a magnifying glass scans an audit document and
 * findings (points) appear one after another. Used for transition states.
 */
export default function AuditLoader({ label }) {
  return (
    <div className="al-wrap" role="status" aria-label={label || 'Loading'}>
      <svg
        className="al-svg"
        viewBox="0 0 200 170"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* document */}
        <rect className="al-doc" x="48" y="22" width="104" height="126" rx="12" />
        {/* text lines */}
        <rect className="al-line" x="62" y="40" width="76" height="6" rx="3" />
        <rect className="al-line" x="62" y="54" width="58" height="6" rx="3" />
        <rect className="al-line" x="62" y="86" width="76" height="6" rx="3" />
        <rect className="al-line" x="62" y="100" width="48" height="6" rx="3" />
        <rect className="al-line" x="62" y="132" width="52" height="6" rx="3" />

        {/* findings appearing one after another */}
        <circle className="al-pt al-pt1" cx="74" cy="60" r="5.5" />
        <circle className="al-pt al-pt2" cx="120" cy="78" r="5.5" />
        <circle className="al-pt al-pt3" cx="82" cy="104" r="5.5" />
        <circle className="al-pt al-pt4" cx="124" cy="120" r="5.5" />

        {/* magnifying glass (lens centered at local origin) */}
        <g className="al-glass">
          <circle className="al-lens" cx="0" cy="0" r="16" />
          <line className="al-handle" x1="11.5" y1="11.5" x2="22" y2="22" />
        </g>
      </svg>
      {label && <p className="al-label">{label}</p>}
    </div>
  )
}
