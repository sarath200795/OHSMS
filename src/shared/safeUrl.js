// ─────────────────────────────────────────────────────────────────────────────
// URL scheme validation for anything that reaches an href or src.
//
// React does not sanitize these. It renders `href="javascript:…"` verbatim and
// the browser executes it on click — verified against this app's own React
// 18.3.1: the warning is dev-only, and production builds print nothing at all.
//
// That matters more here than in most apps. The browser talks to Firestore
// directly, so script running in a signed-in user's page inherits that user's
// full database authority. A member who can type a course link or attach a
// quotation can therefore run code in an admin's session, which is a role
// escalation dressed up as a hyperlink.
//
// So: allow-list the schemes that have a legitimate reason to appear, and
// refuse everything else rather than trying to detect what is dangerous.
// ─────────────────────────────────────────────────────────────────────────────

/** Navigable links: real destinations plus the two contact schemes forms use. */
const LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Inline payloads the app produces itself, for files stored before Cloud
 * Storage existed. `data:text/html` is deliberately absent — it runs script in
 * the page's origin, which is the very thing being prevented.
 */
const DATA_PREFIXES = ['data:image/', 'data:application/pdf', 'data:video/', 'data:audio/']

const FALLBACK = undefined // omit the attribute entirely rather than link to nowhere

/**
 * A URL safe to place in href.
 *
 * @returns the URL, or undefined when it is not something we are willing to link to
 */
export function safeHref(value) {
  // Only a string can be a URL. Coercing an object here yields
  // "[object Object]", which the browser would treat as a relative path — a
  // broken link rather than a dangerous one, but not something to hand back.
  if (typeof value !== 'string') return FALLBACK
  const raw = value.trim()
  if (!raw) return FALLBACK

  // Strip control characters before inspecting the scheme. "java\tscript:alert(1)"
  // is stripped by the HTML parser and becomes live again after we have looked.
  // eslint-disable-next-line no-control-regex -- deliberate: these are exactly the bytes the HTML parser drops
  const url = raw.replace(/[\u0000-\u001F\u007F]/g, '')

  // Relative and absolute-path URLs never carry a scheme and stay in-origin.
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./') || url.startsWith('../')) return url

  const lower = url.toLowerCase()
  if (DATA_PREFIXES.some((p) => lower.startsWith(p))) return url
  if (lower.startsWith('blob:')) return url

  // Anything else must parse and present an allowed scheme. A bare "example.com"
  // fails to parse and is treated as a relative path by the browser, so it is
  // returned as-is; that is a broken link, not a dangerous one.
  try {
    const parsed = new URL(url, 'https://invalid.example')
    if (!LINK_SCHEMES.includes(parsed.protocol)) return FALLBACK
    // Reconstruct from the parser rather than echoing the input, so odd
    // encodings cannot survive the check and mean something else later.
    return url.includes(':') ? parsed.href : url
  } catch {
    return FALLBACK
  }
}

/**
 * A URL safe to place in src (img, iframe, video).
 *
 * Stricter than safeHref: mailto:/tel: are meaningless here, and a src is
 * fetched without the user doing anything, so there is no click to reconsider.
 */
export function safeSrc(value) {
  const url = safeHref(value)
  if (!url) return FALLBACK
  const lower = url.toLowerCase()
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return FALLBACK
  return url
}

/**
 * True when a link is off-site, so callers can add rel="noreferrer noopener".
 * Same-origin and inline payloads do not need it.
 */
export function isExternal(value) {
  const url = safeHref(value)
  if (!url) return false
  return /^https?:/i.test(url)
}
