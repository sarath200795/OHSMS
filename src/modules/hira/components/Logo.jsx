// HIRA logo — a yellow magnifier over a blue shield on a white field
// ("identify" + "protect"). Fixed colours so the brand mark is consistent
// everywhere; place it on a white/light container so it reads clearly.
export default function Logo({ size = 24, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* blue shield on white */}
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        fill="#ffffff"
        stroke="#2563eb"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* yellow magnifier */}
      <g stroke="#eab308" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.6" cy="9.8" r="2.7" fill="rgba(234,179,8,0.16)" />
        <path d="m12.8 12 2.7 2.7" />
      </g>
    </svg>
  )
}
