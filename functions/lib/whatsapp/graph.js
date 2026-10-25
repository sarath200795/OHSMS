// ─────────────────────────────────────────────────────────────────────────────
// Outbound messages through the WhatsApp Cloud API:
//   POST https://graph.facebook.com/{version}/{phone-number-id}/messages
//
// The access token is a System User token scoped to whatsapp_business_messaging
// and is held in Secret Manager. It goes in the Authorization header and
// nowhere else — never into a log line, an error message or a stored row.
// ─────────────────────────────────────────────────────────────────────────────

export const GRAPH_HOST = 'https://graph.facebook.com'

/**
 * `WA_TEMPLATE_WELCOME` / `WA_TEMPLATE_TEST`: `name+lang`, also `name:lang`
 * or `name|lang`. Empty or unparseable means send free-form text instead.
 * The template itself is approved in Meta; this only names it.
 */
export function parseTemplateSpec(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = /^([a-z][a-z0-9_]{0,511})[:|+]([a-z]{2}(?:_[A-Za-z]{2})?)$/i.exec(raw)
  if (!match) return null
  const parts = match[2].split('_')
  const language =
    parts.length === 2
      ? `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`
      : parts[0].toLowerCase()
  return { name: match[1].toLowerCase(), language }
}

export function templatePayload(to, spec) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: spec.name, language: { code: spec.language } },
  }
}

/**
 * The message the test callable should show. 131047 (re-engagement) is Meta
 * refusing a free-form send outside the 24-hour customer-care window. It
 * often arrives later as a status webhook, which this return cannot see —
 * the screen also says that. A synchronous 131047 is still this message.
 */
export function testDeliveryError(result) {
  if (result?.error === 'graph:131047') {
    return {
      code: 'failed-precondition',
      message:
        'WhatsApp could not deliver the test (131047). The recipient must have messaged this number within the last 24 hours. Ask them to send any message to the number, then try again.',
    }
  }
  return { code: 'unavailable', message: 'The test message could not be sent.' }
}

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

/**
 * Reply buttons, not a list. Yes/No is two replies; a list asks the caller
 * to open a menu for a question the text already states. Titles are capped
 * at 20 characters, which is the Cloud API limit, and ids at 256.
 */
export function buttonPayload(to, body, buttons) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: (buttons || []).slice(0, 3).map((button) => ({
          type: 'reply',
          reply: {
            id: String(button.id || '').slice(0, 256),
            title: clip(button.title, 'Choose', 20),
          },
        })),
      },
    },
  }
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
    if (res.ok) {
      let wamid = null
      try {
        const id = (await res.json())?.messages?.[0]?.id
        wamid = typeof id === 'string' && id ? id : null
      } catch {
        wamid = null
      }
      return { ok: true, status: res.status, wamid }
    }
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
