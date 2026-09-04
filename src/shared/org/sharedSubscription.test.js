import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSharedSubscription, clearSharedSubscriptions } from './sharedSubscription'

// The linger that makes route transitions cheap is also a window: for 30
// seconds after the last subscriber leaves, a channel keeps its rows and hands
// them to the next subscriber synchronously, before the listener has re-read
// anything. On a shared site laptop the next subscriber can be a different
// person, whose site scoping and role are not the ones those rows were read
// under. AuthContext already clears the encryption keyring on every identity
// change and says why; these rows are the other half of the same idea.

let started
let emitters

function factory() {
  return createSharedSubscription((key, emit) => {
    started.push(key)
    emitters.set(key, emit)
    return () => emitters.delete(key)
  })
}

beforeEach(() => {
  started = []
  emitters = new Map()
  clearSharedSubscriptions()
})

describe('multiplexing', () => {
  it('opens ONE listener however many subscribers there are', () => {
    const sub = factory()
    sub('orgA', vi.fn())
    sub('orgA', vi.fn())
    sub('orgA', vi.fn())
    expect(started).toEqual(['orgA'])
  })

  it('gives every subscriber each emission', () => {
    const sub = factory()
    const a = vi.fn(); const b = vi.fn()
    sub('orgA', a); sub('orgA', b)
    emitters.get('orgA')([{ id: 1 }])
    expect(a).toHaveBeenCalledWith([{ id: 1 }])
    expect(b).toHaveBeenCalledWith([{ id: 1 }])
  })

  it('hands a late subscriber the cached rows at once', () => {
    const sub = factory()
    sub('orgA', vi.fn())
    emitters.get('orgA')([{ id: 1 }])
    const late = vi.fn()
    sub('orgA', late)
    expect(late).toHaveBeenCalledWith([{ id: 1 }])
  })

  it('keeps separate keys apart', () => {
    const sub = factory()
    sub('orgA', vi.fn()); sub('orgB', vi.fn())
    expect(started).toEqual(['orgA', 'orgB'])
  })
})

describe('an identity change drops the cache', () => {
  it('does NOT hand the next subscriber the previous session rows', () => {
    // The defect. Without the clear, `late` is called synchronously with rows
    // read under somebody else's session.
    const sub = factory()
    const stop = sub('orgA', vi.fn())
    emitters.get('orgA')([{ id: 'read-as-the-manager' }])
    stop()

    clearSharedSubscriptions()

    const late = vi.fn()
    sub('orgA', late)
    expect(late).not.toHaveBeenCalled()
  })

  it('unsubscribes the underlying listener', () => {
    const sub = factory()
    sub('orgA', vi.fn())
    expect(emitters.has('orgA')).toBe(true)
    clearSharedSubscriptions()
    expect(emitters.has('orgA')).toBe(false)
  })

  it('opens a FRESH listener for the next session', () => {
    const sub = factory()
    sub('orgA', vi.fn())
    clearSharedSubscriptions()
    sub('orgA', vi.fn())
    expect(started).toEqual(['orgA', 'orgA'])
  })

  it('reaches every factory, not just the one that was used last', () => {
    const users = factory()
    const sites = factory()
    users('orgA', vi.fn())
    sites('orgA', vi.fn())
    clearSharedSubscriptions()
    expect(emitters.size).toBe(0)
  })

  it('is safe to call when nothing is subscribed', () => {
    expect(() => clearSharedSubscriptions()).not.toThrow()
  })
})
