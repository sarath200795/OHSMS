import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  verifySignature,
  handshakeChallenge,
  safeEqual,
  isRealSecret,
  PLACEHOLDER_SECRET,
} from './signature.js'

const SECRET = 'test-app-secret-not-real-0123'
const sign = (body, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

describe('X-Hub-Signature-256', () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"1"}]}')

  it('accepts the HMAC of the exact raw bytes', () => {
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true)
    expect(
      verifySignature(raw, sign(raw).toUpperCase().replace('SHA256=', 'sha256='), SECRET)
    ).toBe(true)
  })

  // The classic failure: hashing a re-serialised object. Same JSON, different bytes.
  it('rejects a signature over a re-serialised body', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 1))
    expect(verifySignature(reserialised, sign(raw), SECRET)).toBe(false)
  })

  it('rejects a tampered body, a wrong key, and malformed headers', () => {
    const tampered = Buffer.from(raw.toString().replace('"1"', '"2"'))
    expect(verifySignature(tampered, sign(raw), SECRET)).toBe(false)
    expect(verifySignature(raw, sign(raw, 'another-secret-entirely'), SECRET)).toBe(false)
    for (const h of [
      undefined,
      '',
      'sha256=',
      'sha1=abc',
      sign(raw).slice(0, -2),
      `${sign(raw)}00`,
      'sha256=zz',
    ]) {
      expect(verifySignature(raw, h, SECRET)).toBe(false)
    }
  })

  // Anyone who has read this repository knows the placeholder.
  it('never authenticates with the deploy placeholder or an empty secret', () => {
    expect(verifySignature(raw, sign(raw, PLACEHOLDER_SECRET), PLACEHOLDER_SECRET)).toBe(false)
    expect(verifySignature(raw, sign(raw, ''), '')).toBe(false)
    expect(isRealSecret('short')).toBe(false)
  })

  it('refuses a body that is not bytes', () => {
    expect(verifySignature({ object: 'x' }, sign('[object Object]'), SECRET)).toBe(false)
  })
})

describe('GET handshake', () => {
  const token = 'verify-token-for-tests-123'
  const q = (extra) => ({
    'hub.mode': 'subscribe',
    'hub.verify_token': token,
    'hub.challenge': '1158201444',
    ...extra,
  })

  it('echoes the challenge for the right token', () => {
    expect(handshakeChallenge(q(), token)).toBe('1158201444')
  })

  it('refuses a wrong token, a wrong mode, and an unset token', () => {
    expect(handshakeChallenge(q({ 'hub.verify_token': 'nope' }), token)).toBeNull()
    expect(handshakeChallenge(q({ 'hub.mode': 'unsubscribe' }), token)).toBeNull()
    expect(
      handshakeChallenge(q({ 'hub.verify_token': PLACEHOLDER_SECRET }), PLACEHOLDER_SECRET)
    ).toBeNull()
    expect(handshakeChallenge(q({ 'hub.verify_token': '' }), '')).toBeNull()
  })

  // The challenge is reflected into a response body; it must not carry markup.
  it('does not reflect an arbitrary challenge', () => {
    expect(handshakeChallenge(q({ 'hub.challenge': '<script>x</script>' }), token)).toBeNull()
  })

  it('compares safely across lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual(undefined, '')).toBe(true)
  })
})
