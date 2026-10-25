import { describe, it, expect } from 'vitest'
import {
  sendMessage,
  textPayload,
  listPayload,
  buttonPayload,
  graphVersion,
  parseTemplateSpec,
  templatePayload,
  testDeliveryError,
} from './graph.js'

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
    expect(out).toEqual({ ok: true, status: 200, wamid: null })
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v25.0/100000000000001/messages')
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer tkn')
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919000000001',
      type: 'text',
      text: { body: 'hi', preview_url: false },
    })
  })

  it('returns the wamid Graph assigned', async () => {
    const out = await sendMessage({
      fetchImpl: fakeFetch(200, { messages: [{ id: 'wamid.HBgL' }] }),
      version: 'v25.0',
      phoneNumberId: '100000000000001',
      token: 'tkn',
      payload: textPayload('919000000001', 'hi'),
    })
    expect(out).toEqual({ ok: true, status: 200, wamid: 'wamid.HBgL' })
    expect(JSON.stringify(out)).not.toContain('919000000001')
  })

  it('names a template as name+lang and otherwise stays text', () => {
    expect(parseTemplateSpec('')).toBeNull()
    expect(parseTemplateSpec('not a template')).toBeNull()
    expect(parseTemplateSpec('weehs_welcome+en')).toEqual({ name: 'weehs_welcome', language: 'en' })
    expect(parseTemplateSpec('Weehs_Test:en_us')).toEqual({
      name: 'weehs_test',
      language: 'en_US',
    })
    const payload = templatePayload('919000000001', parseTemplateSpec('weehs_test|en'))
    expect(payload).toMatchObject({
      type: 'template',
      to: '919000000001',
      template: { name: 'weehs_test', language: { code: 'en' } },
    })
    expect(payload.text).toBeUndefined()
  })

  it('explains a synchronous 131047 and nothing else', () => {
    const failure = testDeliveryError({ ok: false, error: 'graph:131047' })
    expect(failure.code).toBe('failed-precondition')
    expect(failure.message).toMatch(/131047/)
    expect(failure.message).toMatch(/24 hours/)
    expect(testDeliveryError({ ok: false, error: 'graph:131026' }).code).toBe('unavailable')
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

  it('builds Yes/No reply buttons and caps the title', () => {
    const p = buttonPayload('919000000001', 'Do you need any additional details? (Yes/No)', [
      { id: 'audit:yes', title: 'Yes' },
      { id: 'audit:no', title: 'No' },
    ])
    expect(p.type).toBe('interactive')
    expect(p.interactive.type).toBe('button')
    expect(p.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'audit:yes', title: 'Yes' } },
      { type: 'reply', reply: { id: 'audit:no', title: 'No' } },
    ])
    expect(p.interactive.action.buttons.every((b) => b.reply.title.length <= 20)).toBe(true)
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
