// ─────────────────────────────────────────────────────────────────────────────
// Outbound messages through the WhatsApp Cloud API:
//   POST https://graph.facebook.com/{version}/{phone-number-id}/messages
//
// The access token is a System User token scoped to whatsapp_business_messaging
// and is held in Secret Manager. It goes in the Authorization header and
// nowhere else — never into a log line, an error message or a stored row.
// ─────────────────────────────────────────────────────────────────────────────

export const GRAPH_HOST = 'https://graph.facebook.com'

export function textPayload(to, body) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  }
}

const clip = (value, fallback, max) => {
  const text = String(value || fallback).slice(0, max)
  return text || String(fallback).slice(0, max)
}

export function listPayload(to, body, rows, labels = {}) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: clip(labels.button, 'Choose site', 20),
        sections: [{ title: clip(labels.section, 'Matching sites', 24), rows }],
      },
    },
  }
}

/**
 * Cloud API "location request" interactive message: the client shows a
 * "Send location" button. Clients that cannot render it make the send fail,
 * and the caller falls back to the same body as plain text.
 */
export function locationRequestPayload(to, body) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: body },
      action: { name: 'send_location' },
    },
  }
}

/** A version segment like v25.0; anything else is refused rather than put in a URL. */
export function graphVersion(value) {
  const v = String(value ?? '').trim()
  return /^v\d{1,3}\.\d{1,2}$/.test(v) ? v : null
}

/**
 * Send one message. Resolves { ok, status } and never throws on an HTTP error:
 * the webhook has already claimed the message, and a retry from Meta would be
 * deduplicated away, so the failure is logged by the caller, not re-raised.
 */
export async function sendMessage({
  fetchImpl = fetch,
  version,
  phoneNumberId,
  token,
  payload,
  timeoutMs = 10_000,
}) {
  const v = graphVersion(version)
  if (!v || !/^\d{5,20}$/.test(String(phoneNumberId ?? '')))
    return { ok: false, status: 0, error: 'config' }
  try {
    const res = await fetchImpl(`${GRAPH_HOST}/${v}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.ok) return { ok: true, status: res.status }
    let code = null
    try {
      code = (await res.json())?.error?.code ?? null
    } catch {
      code = null
    }
    return { ok: false, status: res.status, error: code === null ? 'http' : `graph:${code}` }
  } catch (err) {
    return { ok: false, status: 0, error: err?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}
