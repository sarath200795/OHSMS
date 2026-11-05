import { describe, it, expect } from 'vitest'
import {
  validatePassword,
  isAcceptablePassword,
  passwordLengthHint,
  MIN_PASSWORD_LENGTH,
} from './passwordPolicy'

const ok = (pw, ctx) => expect(validatePassword(pw, ctx), pw).toBe('')
const bad = (pw, match, ctx) => expect(validatePassword(pw, ctx), pw).toMatch(match)

describe('one policy, applied everywhere', () => {
  // There were three, and they disagreed: six characters to register an
  // organization or join one, eight to change a forced password. So the founder
  // of a tenant — the account that promotes roles and reads every module — could
  // be protected by six characters, and the stricter rule only ever applied to
  // people already inside.
  it('is longer than the six characters that used to found an organization', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThan(8)
  })

  it('accepts an ordinary strong password', () => {
    ok('correct-horse-battery')
    ok('Tr0ubad0ur&Kite')
  })

  it('refuses one that is too short, at the boundary', () => {
    // Exactly one short, and exactly long enough — both built from the constant
    // so the boundary moves with it rather than quietly becoming untested.
    const short = 'Zx9!qwertyuiop'.slice(0, MIN_PASSWORD_LENGTH - 1)
    const long = 'Zx9!qwertyuiop'.slice(0, MIN_PASSWORD_LENGTH)
    expect(short).toHaveLength(MIN_PASSWORD_LENGTH - 1)
    bad(short, /at least/i)
    ok(long)
  })

  it('refuses nothing at all', () => {
    bad('', /enter a password/i)
    bad(undefined, /enter a password/i)
    bad(null, /enter a password/i)
  })
})

describe('the passwords people actually pick in a hurry', () => {
  // Which is exactly when a provisioned account gets its temporary password.
  it('refuses the obvious ones however they are decorated', () => {
    bad('password123', /easy to guess/i)
    bad('Password2026', /easy to guess/i)
    bad('welcome12345', /easy to guess/i)
    bad('ChangeMe2026!', /easy to guess/i)
  })

  it('refuses one repeated character, whatever its length', () => {
    bad('aaaaaaaaaaaaaaaa', /repeated character/i)
  })

  // A password nobody can retype is a lockout, not a control: leading and
  // trailing spaces survive a paste and then vanish when typed.
  it('refuses leading or trailing whitespace', () => {
    bad(' correct-horse-battery', /space/i)
    bad('correct-horse-battery ', /space/i)
  })
})

describe('a password must not be the person', () => {
  it('refuses one containing their email local part', () => {
    bad('rosei-is-here-now', /email/i, { email: 'rosei@acme.test' })
    // Too short to be meaningful — refusing on it would reject good passwords.
    ok('a-perfectly-fine-one', { email: 'ab@acme.test' })
  })

  it('refuses one containing their first name', () => {
    bad('priya-loves-safety', /your name/i, { name: 'Priya Sharma' })
    ok('a-perfectly-fine-one', { name: 'Al Smith' })
  })

  it('is case-insensitive about both', () => {
    bad('ROSEI-and-more-here', /email/i, { email: 'rosei@acme.test' })
  })

  it('does not throw when it is told nothing about the person', () => {
    ok('correct-horse-battery', {})
    ok('correct-horse-battery')
  })
})

describe('the hint and the checker name the same floor', () => {
  // The screens used to say six or eight while this file refused ten. The hint
  // is derived, and the boundary below is built from the same constant, so a
  // later edit cannot move one without the other.
  it('states MIN_PASSWORD_LENGTH and nothing else', () => {
    expect(passwordLengthHint()).toBe(`At least ${MIN_PASSWORD_LENGTH} characters`)
  })

  it('refuses one character under the hint and accepts the hint length', () => {
    const alphabet = 'Zx9!qwertyuiop'
    const short = alphabet.slice(0, MIN_PASSWORD_LENGTH - 1)
    const exact = alphabet.slice(0, MIN_PASSWORD_LENGTH)
    expect(short).toHaveLength(MIN_PASSWORD_LENGTH - 1)
    expect(exact).toHaveLength(MIN_PASSWORD_LENGTH)
    expect(validatePassword(short)).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    )
    expect(validatePassword(exact)).toBe('')
    expect(passwordLengthHint()).toContain(String(MIN_PASSWORD_LENGTH))
    expect(validatePassword(short)).toContain(String(MIN_PASSWORD_LENGTH))
  })
})

describe('the convenience wrapper', () => {
  it('agrees with the message form', () => {
    expect(isAcceptablePassword('correct-horse-battery')).toBe(true)
    expect(isAcceptablePassword('short')).toBe(false)
  })
})
