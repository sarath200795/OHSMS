import { describe, it, expect } from 'vitest'
import { extractMessages, parseCommand, readLocation, cleanQuery, normaliseWaId } from './parse.js'

const PNID = '100000000000001'
const payload = (value) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PNID }, ...value },
        },
      ],
    },
  ],
})

describe('extractMessages', () => {
  it('reads text and interactive replies, and drops the profile name', () => {
    const { messages } = extractMessages(
      payload({
        contacts: [{ profile: { name: 'Test Person' }, wa_id: '919000000001' }],
        messages: [
          {
            from: '919000000001',
            id: 'wamid.A',
            timestamp: '1760000000',
            type: 'text',
            text: { body: 'BLR0123' },
          },
          {
            from: '919000000001',
            id: 'wamid.B',
            timestamp: '1760000001',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'site:s1', title: 'X' } },
          },
        ],
      }),
      PNID
    )
    expect(messages).toEqual([
      {
        wamid: 'wamid.A',
        from: '919000000001',
        timestamp: 1760000000,
        type: 'text',
        text: 'BLR0123',
        choiceId: '',
        location: null,
      },
      {
        wamid: 'wamid.B',
        from: '919000000001',
        timestamp: 1760000001,
        type: 'interactive',
        text: 'X',
        choiceId: 'site:s1',
        location: null,
      },
    ])
    expect(JSON.stringify(messages)).not.toContain('Test Person')
  })

  it('counts statuses without answering them', () => {
    const out = extractMessages(
      payload({ statuses: [{ id: 'wamid.X', status: 'delivered' }] }),
      PNID
    )
    expect(out).toEqual({ messages: [], statuses: 1 })
  })

  it('ignores another business number, other objects and junk', () => {
    expect(
      extractMessages(
        payload({
          messages: [{ from: '919000000001', id: 'w', type: 'text', text: { body: 'x' } }],
        }),
        '999'
      ).messages
    ).toEqual([])
    expect(extractMessages({ object: 'page', entry: [] }, PNID).messages).toEqual([])
    expect(extractMessages(null, PNID).messages).toEqual([])
    expect(
      extractMessages({ object: 'whatsapp_business_account', entry: 'x' }, PNID).messages
    ).toEqual([])
    expect(
      extractMessages(payload({ messages: [{ from: 'abc', id: 'w', type: 'text' }] }), PNID)
        .messages
    ).toEqual([])
  })

  it('normalises wa ids to digits', () => {
    expect(normaliseWaId('+91 90000 00001')).toBe('919000000001')
    expect(normaliseWaId('123')).toBe('')
  })
})

describe('parseCommand', () => {
  const p = (text, choiceId) => parseCommand({ text, choiceId })

  it('reads LINK with a six-digit code, tolerating spaces and dashes', () => {
    expect(p('LINK 482913')).toEqual({ kind: 'link', code: '482913' })
    expect(p('link 482-913')).toEqual({ kind: 'link', code: '482913' })
    expect(p('Link 048 291')).toEqual({ kind: 'link', code: '048291' })
    expect(p('LINK 12345')).toEqual({ kind: 'badLink' })
    expect(p('LINK abcdef')).toEqual({ kind: 'badLink' })
  })

  it('reads UNLINK, STOP, HELP, MENU and CHANGE ORG', () => {
    expect(p('UNLINK').kind).toBe('unlink')
    expect(p('stop').kind).toBe('unlink')
    expect(p('Help').kind).toBe('help')
    expect(p('?').kind).toBe('help')
    expect(p('MENU').kind).toBe('menu')
    expect(p('change org').kind).toBe('changeOrg')
    expect(p('Switch organisation').kind).toBe('changeOrg')
  })

  it('strips greetings and treats the rest as a site query', () => {
    expect(p('Hi')).toEqual({ kind: 'greeting' })
    expect(p('hello site BLR0123!')).toEqual({ kind: 'site', query: 'blr0123' })
    expect(p('  Cult   Koramangala ')).toEqual({ kind: 'site', query: 'cult koramangala' })
  })

  it('accepts only the list-row ids this bot sends', () => {
    expect(p('X', 'site:abc_123')).toEqual({
      kind: 'choice',
      choiceKind: 'site',
      siteId: 'abc_123',
    })
    expect(p('X', 'org:acme_1')).toEqual({ kind: 'choice', choiceKind: 'org', orgId: 'acme_1' })
    expect(p('X', 'site:../users').kind).toBe('site')
    expect(p('X', 'org:../users').kind).toBe('site')
  })

  it('bounds and cleans the query', () => {
    expect(cleanQuery('a'.repeat(500)).length).toBe(120)
    expect(cleanQuery('x\u0000y')).toBe('x y')
  })
})

describe('location messages', () => {
  const payload = (location) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'PNID' },
              messages: [
                {
                  id: 'wamid.L',
                  from: '919000000001',
                  timestamp: '1760000000',
                  type: 'location',
                  location,
                },
              ],
            },
          },
        ],
      },
    ],
  })
  it('keeps only the two numbers from a shared location', () => {
    const [m] = extractMessages(
      payload({ latitude: 12.5, longitude: 77.25, name: 'Home', address: '1 Fake St' }),
      'PNID'
    ).messages
    expect(m.location).toEqual({ latitude: 12.5, longitude: 77.25 })
    expect(JSON.stringify(m)).not.toContain('Fake St')
    expect(parseCommand(m)).toEqual({ kind: 'location', latitude: 12.5, longitude: 77.25 })
  })
  it('rejects junk, out-of-range and 0,0', () => {
    expect(readLocation({ latitude: 'x', longitude: 1 })).toBeNull()
    expect(readLocation({ latitude: 91, longitude: 1 })).toBeNull()
    expect(readLocation({ latitude: 0, longitude: 0 })).toBeNull()
    expect(parseCommand({ type: 'location', location: null })).toEqual({ kind: 'badLocation' })
  })
})
