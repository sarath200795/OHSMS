import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { getAdminApp, isEmulated } from './firestore.js'

afterEach(() => vi.unstubAllEnvs())

describe('knowing whether it is pointed at an emulator', () => {
  it('reports what the Admin SDK will actually do', () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080')
    expect(isEmulated()).toBe(true)
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '')
    expect(isEmulated()).toBe(false)
  })
})

describe('the guard that keeps a test off production', () => {
  // THE FAILURE THIS PREVENTS. firebase-admin does not evaluate
  // firestore.rules — a test run that reached the real database would write to
  // a real tenant's records with nothing refusing it, and the first anyone
  // would know is a customer asking who filed an inspection at 2am. vitest
  // sets NODE_ENV=test, so the only way a test reaches Firestore at all is
  // with the emulator host set, deliberately, by the person running it.
  // These control the variable rather than reading whatever the shell happens
  // to have. They used to assume it was absent, which made the suite green only
  // when run WITHOUT emulators — and attack.test.js is green only WITH them, so
  // no single run could ever pass everything. A guard that can only be tested in
  // one half of the matrix is a guard nobody runs.
  let saved
  beforeEach(() => {
    saved = process.env.FIRESTORE_EMULATOR_HOST
    delete process.env.FIRESTORE_EMULATOR_HOST
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
    else process.env.FIRESTORE_EMULATOR_HOST = saved
  })

  it('refuses to initialise in a test with no emulator host', () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(() => getAdminApp()).toThrow(/FIRESTORE_EMULATOR_HOST/)
  })

  it('says what to do about it, rather than just failing', () => {
    expect(() => getAdminApp()).toThrow(/emulator|stub/i)
  })
})
