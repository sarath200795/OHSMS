import { describe, it, expect } from 'vitest'
import { sanitizeUrl, sanitizeEvent } from './monitoring'

// ─────────────────────────────────────────────────────────────────────────────
// Sentry is a third party in another jurisdiction, and this app has public
// routes WHOSE PATH IS THE CREDENTIAL — /qr/:token, /permit/:token and /p/:id
// are scanned off a sticker or off a permit at a barrier, and the string in the
// URL is the whole of the authorisation. An error thrown on one of those pages
// shipped the full URL by default, which puts a live bearer token in a third
// party's inbox and in whatever they retain.
//
// These tests are about one thing: what leaves the origin.
// ─────────────────────────────────────────────────────────────────────────────

describe('scan tokens never leave the origin', () => {
  it('replaces the token on every public scan route', () => {
    expect(sanitizeUrl('https://suite.weehs.org/qr/8f3ka92mz01xqp'))
      .toBe('https://suite.weehs.org/qr/:token')
    expect(sanitizeUrl('https://suite.weehs.org/permit/aa11bb22cc33dd'))
      .toBe('https://suite.weehs.org/permit/:token')
    expect(sanitizeUrl('https://suite.weehs.org/p/PROC-9931'))
      .toBe('https://suite.weehs.org/p/:token')
  })

  it('keeps the route, which is the half worth reporting', () => {
    // "an error on /qr" is actionable; "an error somewhere" is not.
    const out = sanitizeUrl('https://suite.weehs.org/qr/8f3ka92mz01xqp')
    expect(out).toContain('/qr/')
    expect(out).not.toContain('8f3ka92mz01xqp')
  })

  it('drops anything trailing the token rather than guessing at it', () => {
    expect(sanitizeUrl('https://suite.weehs.org/qr/tok/extra/parts'))
      .toBe('https://suite.weehs.org/qr/:token')
  })

  it('leaves ordinary in-app routes alone', () => {
    expect(sanitizeUrl('https://suite.weehs.org/incidents/inc1'))
      .toBe('https://suite.weehs.org/incidents/inc1')
    expect(sanitizeUrl('/portal/dashboard')).toBe('/portal/dashboard')
  })

  it('strips the query string and the fragment everywhere', () => {
    // Not a token route, but a query string is where an id or a filter with a
    // name in it ends up, and none of it is needed to diagnose a crash.
    expect(sanitizeUrl('https://suite.weehs.org/injuries?person=R.%20Osei&q=laceration'))
      .toBe('https://suite.weehs.org/injuries')
    expect(sanitizeUrl('https://suite.weehs.org/qr/tok?debug=1#frag'))
      .toBe('https://suite.weehs.org/qr/:token')
  })

  it('returns a relative path for a relative input', () => {
    expect(sanitizeUrl('/qr/tok')).toBe('/qr/:token')
  })

  // `new URL(x, base)` accepts far more than it looks like it should — a bare
  // string parses as a relative path — so the catch branch is a backstop rather
  // than the common route. What matters either way is that nothing after a `?`
  // survives, whichever branch ran.
  it('drops the secret from something that is barely a URL', () => {
    expect(sanitizeUrl('not a url at all?secret=x')).not.toContain('secret')
    expect(sanitizeUrl('://%%%?secret=x')).not.toContain('secret')
  })

  it('passes through the empty and absent cases untouched', () => {
    expect(sanitizeUrl('')).toBe('')
    expect(sanitizeUrl(null)).toBeNull()
    expect(sanitizeUrl(undefined)).toBeUndefined()
  })
})

describe('the event Sentry actually receives', () => {
  it('scrubs the request url, the query string and the referer', () => {
    const event = sanitizeEvent({
      request: {
        url: 'https://suite.weehs.org/permit/live-token-here?x=1',
        query_string: 'x=1&person=R.%20Osei',
        headers: { Referer: 'https://suite.weehs.org/qr/another-token', 'User-Agent': 'Firefox' },
      },
    })
    expect(event.request.url).toBe('https://suite.weehs.org/permit/:token')
    expect(event.request.query_string).toBeUndefined()
    expect(event.request.headers.Referer).toBeUndefined()
    // Not everything on the request is sensitive; the user agent is what tells
    // you the crash is Safari-only.
    expect(event.request.headers['User-Agent']).toBe('Firefox')
  })

  // Breadcrumbs carry one URL per navigation and ride along with every event,
  // so scrubbing only the event would leave the token in the trail beside it.
  it('scrubs the breadcrumb trail too', () => {
    const event = sanitizeEvent({
      breadcrumbs: [
        { data: { url: 'https://suite.weehs.org/qr/tok-one' } },
        { data: { url: 'https://suite.weehs.org/incidents' } },
        { message: 'no url here' },
      ],
    })
    expect(event.breadcrumbs[0].data.url).toBe('https://suite.weehs.org/qr/:token')
    expect(event.breadcrumbs[1].data.url).toBe('https://suite.weehs.org/incidents')
    expect(event.breadcrumbs[2].message).toBe('no url here')
  })

  it('survives the shapes an event can arrive in', () => {
    expect(sanitizeEvent(null)).toBeNull()
    expect(sanitizeEvent({})).toEqual({})
    expect(sanitizeEvent({ request: {} }).request).toEqual({})
  })

  // The whole payload, not one field: a token reintroduced anywhere on the
  // event by a future SDK default fails here.
  it('leaves no token anywhere in the serialised event', () => {
    const event = sanitizeEvent({
      request: {
        url: 'https://suite.weehs.org/qr/SECRETTOKEN',
        query_string: 'token=SECRETTOKEN',
        headers: { Referer: 'https://suite.weehs.org/permit/SECRETTOKEN' },
      },
      breadcrumbs: [{ data: { url: 'https://suite.weehs.org/p/SECRETTOKEN' } }],
    })
    expect(JSON.stringify(event)).not.toContain('SECRETTOKEN')
  })
})
