import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { log } from './log.js'

let out, err
beforeEach(() => {
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((line) => out.push(line))
  vi.spyOn(console, 'error').mockImplementation((line) => err.push(line))
})
afterEach(() => vi.restoreAllMocks())

describe('a line Cloud Run can read', () => {
  // Cloud Run lifts `severity` and `message` out of a JSON line on stdout. A
  // plain string is logged at DEFAULT, so a refused token and a crashed
  // process look identical in the console and neither can be alerted on.
  it('is JSON, carrying a severity and a message', () => {
    log.info('server listening', { port: 8080 })
    expect(JSON.parse(out[0])).toEqual({ severity: 'INFO', message: 'server listening', port: 8080 })
  })

  it('uses the severities the platform recognises', () => {
    log.info('a')
    log.warn('b')
    log.error('c')
    expect(JSON.parse(out[0]).severity).toBe('INFO')
    expect(JSON.parse(out[1]).severity).toBe('WARNING')
    expect(JSON.parse(err[0]).severity).toBe('ERROR')
  })

  it('sends errors to stderr and everything else to stdout', () => {
    log.error('boom')
    expect(out).toHaveLength(0)
    expect(err).toHaveLength(1)
  })

  it('works with no fields at all', () => {
    log.info('bare')
    expect(JSON.parse(out[0])).toEqual({ severity: 'INFO', message: 'bare' })
  })
})

describe('when the fields cannot be serialised', () => {
  // Losing the fields is survivable. Losing the line — and with it the reason
  // a request was refused — turns a security decision into something nobody
  // can audit afterwards.
  it('still writes the line, saying the fields were lost', () => {
    const cycle = {}
    cycle.self = cycle

    expect(() => log.warn('auth refused', { cycle })).not.toThrow()
    expect(JSON.parse(out[0])).toEqual({
      severity: 'WARNING',
      message: 'auth refused',
      fields: 'unserialisable',
    })
  })
})
