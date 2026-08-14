import { describe, it, expect } from 'vitest'
import { writeErrorMessage, isTransient } from './writeError'

const err = (code, message = '') => Object.assign(new Error(message), { code })

// The distinction this file exists for. A dropped connection and a refused
// write are the same rejected promise to the UI, and they were being reported
// interchangeably — but they are opposite instructions: one means try again in
// a minute, the other means stop and find an administrator.
describe('telling a dropped connection from a refusal', () => {
  it('names the connection when the browser knows it is offline', () => {
    const m = writeErrorMessage(err('permission-denied'), { online: false, action: 'import' })
    expect(m).toMatch(/connection dropped/i)
    expect(m).not.toMatch(/permission/i)
  })

  // Offline wins even over a permission code, because a client that cannot
  // reach the server cannot have been told anything by it. That is exactly the
  // case that told someone running a bulk import they were not allowed to do
  // their job.
  it('trusts offline over whatever code came back', () => {
    expect(isTransient(err('permission-denied'), { online: false })).toBe(true)
  })

  it('names the connection for the codes Firestore raises when it cannot reach the server', () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'cancelled', 'aborted']) {
      expect(writeErrorMessage(err(code), { action: 'import' }), code).toMatch(/connection dropped/i)
      expect(isTransient(err(code)), code).toBe(true)
    }
  })

  // What the console actually printed during the incident. Firestore's own
  // wording names a WebChannel stream, which tells a safety officer nothing.
  it('recognises the transport failures by their text alone', () => {
    for (const text of [
      'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NAME_NOT_RESOLVED',
      "WebChannelConnection RPC 'Listen' stream 0x4d35387e transport errored: il",
      'Failed to fetch',
    ]) {
      expect(writeErrorMessage(err('', text), { action: 'import' }), text).toMatch(/connection dropped/i)
    }
  })

  it('says so plainly when the write really was refused', () => {
    const m = writeErrorMessage(err('permission-denied'), { action: 'import' })
    expect(m).toMatch(/do not have permission/i)
    expect(m).toMatch(/administrator/i)
    expect(isTransient(err('permission-denied'))).toBe(false)
  })

  it('handles being throttled', () => {
    expect(writeErrorMessage(err('resource-exhausted'), { action: 'import' })).toMatch(/too many writes/i)
  })

  it('passes an unrecognised failure through rather than inventing a diagnosis', () => {
    expect(writeErrorMessage(err('invalid-argument', 'Document path cannot be empty'), { action: 'import' }))
      .toBe('Document path cannot be empty')
  })

  it('never returns an empty string, whatever it is given', () => {
    expect(writeErrorMessage(undefined, { action: 'import' })).toBeTruthy()
    expect(writeErrorMessage({}, { action: 'import' })).toBeTruthy()
    expect(writeErrorMessage(null)).toBeTruthy()
  })

  it('says what failed, using the caller word', () => {
    expect(writeErrorMessage(err('permission-denied'), { action: 'import' })).toContain('import')
    expect(writeErrorMessage(err('unavailable'), { action: 'submit the inspection' }))
      .toContain('submit the inspection')
  })

  // navigator.onLine is only trustworthy when it says false: true merely means
  // an interface is up, which a captive portal or dead resolver also satisfies.
  it('does not treat online:true as proof the server was reachable', () => {
    expect(writeErrorMessage(err('unavailable'), { online: true })).toMatch(/connection dropped/i)
  })
})
