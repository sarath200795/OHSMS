import { describe, it, expect } from 'vitest'
import { sendMessage, textPayload, listPayload, graphVersion } from './graph.js'

const fakeFetch = (status, body = {}) => {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  fn.calls = calls
  return fn
}

describe('Graph sends', () => {
  it('posts to /{version}/{phone-number-id}/messages with a bearer token', async () => {
    const f = fakeFetch(200)
    const out = await sendMessage({
      fetchImpl: f,
      version: 'v25.0',
      phoneNumberId: '100000000000001',
      token: 'tkn',
      payload: textPayload('919000000001', 'hi'),
    })
    expect(out).toEqual({ ok: true, status: 200 })
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v25.0/100000000000001/messages')
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer tkn')
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919000000001',
      type: 'text',
      text: { body: 'hi', preview_url: false },
    })
  })

  it('reports a Graph error code without the token', async () => {
    const out = await sendMessage({
      fetchImpl: fakeFetch(400, { error: { code: 131047 } }),
      version: 'v25.0',
      phoneNumberId: '100000000000001',
      token: 'secret-token',
      payload: {},
    })
    expect(out).toEqual({ ok: false, status: 400, error: 'graph:131047' })
    expect(JSON.stringify(out)).not.toContain('secret-token')
  })

  it('refuses a malformed version or number id instead of building a URL from it', async () => {
    const f = fakeFetch(200)
    expect(
      (
        await sendMessage({
          fetchImpl: f,
          version: '../v1',
          phoneNumberId: '1000001',
          token: 't',
          payload: {},
        })
      ).error
    ).toBe('config')
    expect(
      (
        await sendMessage({
          fetchImpl: f,
          version: 'v25.0',
          phoneNumberId: '12/x',
          token: 't',
          payload: {},
        })
      ).error
    ).toBe('config')
    expect(f.calls).toHaveLength(0)
    expect(graphVersion('v25.0')).toBe('v25.0')
  })

  it('survives a network failure', async () => {
    const out = await sendMessage({
      fetchImpl: async () => {
        throw new Error('boom')
      },
      version: 'v25.0',
      phoneNumberId: '1000001',
      token: 't',
      payload: {},
    })
    expect(out).toEqual({ ok: false, status: 0, error: 'network' })
  })

  it('builds an interactive list', () => {
    const p = listPayload('9190', 'Pick', [{ id: 'site:s1', title: 'A', description: 'B' }])
    expect(p.interactive.action.sections[0].rows).toHaveLength(1)
    expect(p.interactive.action.button).toBe('Choose site')
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20)
  })

  it('names the organisation list without exceeding the button length', () => {
    const p = listPayload('9190', 'Which organisation?', [], {
      button: 'Choose organisation',
      section: 'Organisations',
    })
    expect(p.interactive.action.button).toBe('Choose organisation')
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20)
    expect(p.interactive.action.sections[0].title).toBe('Organisations')
  })
})
