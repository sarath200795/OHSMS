import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { deliveryDecision } from './assignmentNotify.js'
import { addressDecision } from './incidentReportNotify.js'
import { recipientAddress } from './audience.js'
import { mailboxAddress } from './mailAddress.js'
import { parseFrom } from './mailer.js'

const require = createRequire(import.meta.url)
const loaded = require('nodemailer/lib/addressparser')
const addressparser = typeof loaded === 'function' ? loaded : loaded.default

function addressesOf(nodes) {
  const out = []
  for (const node of nodes || []) {
    if (node?.address) out.push(node.address)
    if (node?.group) out.push(...addressesOf(node.group))
  }
  return out
}

const profile = (email) => ({
  uid: 'u1',
  orgId: 'orgA',
  status: 'approved',
  role: 'member',
  email,
})

// Shapes the address parser has mis-read as a second mailbox. None of them
// is an address this app stores, and none of them may be handed to sendMail.
const REJECTED = [
  'a@b.com evil@c.com',
  'a@b.com,c@d.com',
  'a,b@c.com',
  'a;b@c.com',
  'Victim (x(y) <evil@evil.com>) <v@victim.com>',
  'G: (a; <evil@evil.com>) <v@victim.com>;',
  'G: "a;" "<evil@evil.com>" <v@victim.com>;',
  '<"a@evil.com>"@good.com>',
  'Legit User <user@good-corp.com(x)evil.com>',
  'user@good-corp.com(x)evil.com',
]

describe('mailbox checks', () => {
  it('keeps a plain mailbox, including plus-addressing', () => {
    expect(mailboxAddress(' ravi@example.com ')).toBe('ravi@example.com')
    expect(mailboxAddress('user+tag@example.co.uk')).toBe('user+tag@example.co.uk')
    expect(
      deliveryDecision({ assigneeUid: 'u1', user: profile('ravi@example.com'), orgId: 'orgA' })
    ).toEqual({ send: true, email: 'ravi@example.com' })
    expect(recipientAddress(profile('user+tag@example.com'), 'orgA')).toEqual({
      uid: 'u1',
      email: 'user+tag@example.com',
    })
  })

  it('rejects a second @, a space, a comma, and the parser syntax those advisories used', () => {
    for (const email of REJECTED) {
      expect(mailboxAddress(email), email).toBe('')
      const from = parseFrom(email)
      // A display name that would open another header is dropped. What remains
      // is one mailbox, or nothing. It is never the address hidden in the comment.
      if (from) {
        const angled = from.match(/^(.*)<([^<>]+)>$/)
        const kept = angled ? angled[2].trim() : from
        expect(mailboxAddress(kept), email).toBe(kept)
      }
      expect(from, email).not.toContain('evil@')
      expect(
        deliveryDecision({ assigneeUid: 'u1', user: profile(email), orgId: 'orgA' }).reason,
        email
      ).toBe('no-email')
      expect(recipientAddress(profile(email), 'orgA'), email).toBeNull()
      expect(addressDecision(profile(email), 'orgA').reason, email).toBe('no-email')
    }
  })
})

describe('the installed address parser', () => {
  it('keeps a nested comment from becoming a recipient', () => {
    expect(addressesOf(addressparser('Victim (x(y) <evil@evil.com>) <v@victim.com>'))).toEqual([
      'v@victim.com',
    ])
  })

  it('does not end a group at a semicolon inside a comment or a quoted name', () => {
    expect(addressesOf(addressparser('G: (a; <evil@evil.com>) <v@victim.com>;'))).toEqual([
      'v@victim.com',
    ])
    expect(addressesOf(addressparser('G: "a;" "<evil@evil.com>" <v@victim.com>;'))).toEqual([
      'v@victim.com',
    ])
  })

  it('does not take the domain from a greater-than inside a quoted local part', () => {
    const [address] = addressesOf(addressparser('<"a@evil.com>"@good.com>'))
    expect(address.endsWith('@good.com')).toBe(true)
    expect(address).not.toBe('a@evil.com')
  })

  it('strips a comment inside an angle address out of the mailbox', () => {
    expect(addressesOf(addressparser('Legit User <user@good-corp.com(x)evil.com>'))).toEqual([
      'user@good-corp.com',
    ])
  })
})
