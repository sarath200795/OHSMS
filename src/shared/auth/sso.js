// ─────────────────────────────────────────────────────────────────────────────
// Single sign-on providers, declared by configuration rather than code.
//
// Every enterprise brings its own identity provider, so which ones exist is a
// deployment fact, not a source-code fact. They are declared in one env var:
//
//   VITE_SSO_PROVIDERS="saml.acme:Acme SSO,oidc.okta:Okta"
//
// comma-separated, each `providerId:Button label`. The label is optional and
// falls back to something readable derived from the id.
//
// The provider id is NOT free text — Firebase requires SAML providers to start
// `saml.` and OIDC providers `oidc.`, and the id must match one configured in
// the Identity Platform console. A typo there fails at sign-in with an opaque
// error, so malformed entries are dropped here and reported once, rather than
// rendering a button that cannot work.
//
// Nothing is enabled by default. With the var unset there are no SSO buttons
// and the login page is exactly what it was.
// ─────────────────────────────────────────────────────────────────────────────

const KINDS = { 'saml.': 'saml', 'oidc.': 'oidc' }

const kindOf = (id) => {
  const prefix = Object.keys(KINDS).find((p) => id.startsWith(p))
  return prefix ? KINDS[prefix] : null
}

/** "saml.acme-corp" → "Acme Corp", so a missing label still reads as a company. */
function labelFrom(id) {
  const bare = id.replace(/^(saml|oidc)\./, '').replace(/[-_]+/g, ' ').trim()
  if (!bare) return 'Single sign-on'
  return bare.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Parse the env var into providers the login page can render.
 *
 * Invalid entries are dropped rather than thrown, because a bad value in
 * someone's .env must not take the whole login page down — without a password
 * form there is no way back in. `problems` carries what was rejected so it can
 * be logged once at startup.
 */
export function parseSsoProviders(raw) {
  const providers = []
  const problems = []
  const seen = new Set()

  String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const idx = entry.indexOf(':')
      const id = (idx === -1 ? entry : entry.slice(0, idx)).trim()
      const label = idx === -1 ? '' : entry.slice(idx + 1).trim()

      const kind = kindOf(id)
      if (!kind) {
        problems.push(`"${id}" — a provider id must start with "saml." or "oidc."`)
        return
      }
      if (id.length <= 5) {
        problems.push(`"${id}" — nothing after the prefix`)
        return
      }
      if (seen.has(id)) {
        problems.push(`"${id}" — listed more than once`)
        return
      }
      seen.add(id)
      providers.push({ id, kind, label: label || labelFrom(id) })
    })

  return { providers, problems }
}

const parsed = parseSsoProviders(import.meta.env?.VITE_SSO_PROVIDERS)

if (parsed.problems.length) {
  // Once, at startup. A dropped provider is invisible otherwise — the button
  // simply is not there, which looks like the feature was never built.
  // eslint-disable-next-line no-console
  console.error(`[sso] ignoring malformed VITE_SSO_PROVIDERS entries:\n  ${parsed.problems.join('\n  ')}`)
}

export const SSO_PROVIDERS = parsed.providers
export const hasSso = SSO_PROVIDERS.length > 0
