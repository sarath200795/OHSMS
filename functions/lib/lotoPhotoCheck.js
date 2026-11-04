// Server-side check of a lockout photo: a lock, a tag, and the tag on the lock.
//
// The API key is the Firebase secret LOTO_LOCK_PHOTO_API_KEY. The operator
// sets it themselves. This module never reads process.env for it and never
// prints it. An empty key is "unavailable", not a pass and not a fail.

export const LOTO_LOCK_PHOTO_SECRET = 'LOTO_LOCK_PHOTO_API_KEY'

const PROMPT =
  'You are checking a lockout/tagout photo taken at an isolation point. Reply with JSON only: ' +
  '{"lock_present":true|false,"tag_present":true|false,"tag_attached_to_lock":true|false,"confidence":0-1,"reason":"short"}. ' +
  'lock_present = a safety padlock or lockout device is visibly applied. ' +
  'tag_present = a danger / lockout tag is visible. ' +
  'tag_attached_to_lock = the tag hangs from that lock or lockout device.'

const MODEL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

export function judgePhotoCheck(parsed) {
  const lock = parsed?.lock_present === true
  const tag = parsed?.tag_present === true
  const attached = parsed?.tag_attached_to_lock === true
  return {
    status: lock && tag && attached ? 'pass' : 'fail',
    lock,
    tag,
    attached,
    confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : null,
    reason: typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 300) : '',
  }
}

function parseModelJson(payload) {
  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try {
    return JSON.parse(match[0])
  } catch {
    return {}
  }
}

/**
 * `imageBase64` is the raw base64 of a jpeg, without the data: prefix.
 * `fetchImpl` is injectable so the test never calls the network.
 */
export async function checkLockPhoto({ apiKey, imageBase64, fetchImpl = fetch }) {
  if (!apiKey) {
    return { status: 'unavailable', lock: false, tag: false, attached: false, confidence: null, reason: `${LOTO_LOCK_PHOTO_SECRET} is not set` }
  }
  const response = await fetchImpl(`${MODEL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ],
      }],
    }),
  })
  if (!response.ok) {
    return { status: 'unavailable', lock: false, tag: false, attached: false, confidence: null, reason: 'The photo check did not answer' }
  }
  return judgePhotoCheck(parseModelJson(await response.json()))
}
