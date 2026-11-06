// The page the handoff contact opens from the one-time email. It is served by
// the control-plane host, not by the shared SPA. The registration wizard has
// no password fields; this page is the only form that accepts the allowlist
// in intake.mjs. It does not echo a submitted secret back.

import { INTAKE_FIELDS } from './intake.mjs'

const REASONS = {
  database: 'The database credential this mode needs was not in the handoff.',
  engine: 'That engine has no adapter, so the request was not marked live.',
  empty: 'Nothing was submitted. Enter at least one secret and try the link again.',
  reused: 'That link was already used.',
  token: 'That link is not valid.',
  email: 'That email is not the handoff contact for this request.',
  'already-live': 'This organization is already live.',
  echo: 'The result could not be shown.',
  fulfill: 'The secrets were stored, and fulfillment did not finish.',
  shape: 'That submission could not be read.',
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title, inner) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #fff; margin: 0; }
  main { max-width: 36rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
  label { display: block; font-weight: 600; margin-top: 1rem; }
  .hint { display: block; font-weight: 400; color: #333; }
  input { width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.5rem; font: inherit; }
  button { margin-top: 1.25rem; padding: 0.6rem 1rem; font: inherit; }
  a { color: #0b3a82; }
</style>
</head>
<body>
<main>
${inner}
</main>
</body>
</html>`
}

export function renderHandoffForm({ requestId, token, orgName }) {
  const who = orgName ? escapeHtml(orgName) : 'this organization'
  const fields = INTAKE_FIELDS.map(
    (field) => `<label for="${escapeHtml(field.key)}">${escapeHtml(field.label)}
<span class="hint">${escapeHtml(field.hint)}</span>
<input id="${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" type="password" autocomplete="off" spellcheck="false">
</label>`
  ).join('\n')
  return page(
    'Secret handoff',
    `<h1>Secret handoff</h1>
<p>Submit the secrets for ${who}. They are stored on this host only. They are not written onto the provisioning request, and this page does not send them back.</p>
<form method="post" action="/handoff">
<input type="hidden" name="request" value="${escapeHtml(requestId)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<label for="email">Handoff email
<span class="hint">The address this link was sent to.</span>
<input id="email" name="email" type="email" autocomplete="username" required>
</label>
${fields}
<button type="submit">Submit secrets</button>
</form>`
  )
}

export function renderHandoffRefusal() {
  return page(
    'Handoff refused',
    `<h1>Handoff refused</h1>
<p>That link cannot be used. Ask the control plane to send a new one.</p>`
  )
}

export function renderHandoffResult({ ok, orgName, dedicatedUrl, reason }) {
  const who = orgName ? escapeHtml(orgName) : 'The organization'
  if (ok && dedicatedUrl) {
    const href = escapeHtml(dedicatedUrl)
    return page(
      'Organization is live',
      `<h1>Organization is live</h1>
<p>${who} is ready at <a href="${href}">${href}</a>. Sign in there with your company's identity provider. This page does not show secrets.</p>`
    )
  }
  const detail = REASONS[reason] || 'The handoff did not finish.'
  return page(
    'Handoff incomplete',
    `<h1>Handoff incomplete</h1>
<p>${escapeHtml(detail)} Nothing on this page is a secret.</p>`
  )
}
