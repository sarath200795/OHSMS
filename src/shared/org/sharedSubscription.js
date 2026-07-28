// ─────────────────────────────────────────────────────────────────────────────
// Ref-counted shared Firestore subscriptions.
//
// Many module contexts subscribe to the same org-wide data (users, sites). At
// scale (5 000 employees) each duplicate onSnapshot costs a full re-read of the
// collection per mount. This helper multiplexes any number of subscribers over
// ONE underlying listener per key: late subscribers get the cached data
// immediately, and the listener is torn down (after a short linger, so route
// transitions don't thrash it) when the last subscriber leaves.
// ─────────────────────────────────────────────────────────────────────────────

const LINGER_MS = 30_000

export function createSharedSubscription(startListener) {
  const channels = new Map() // key → { data, hasData, subs:Set, unsub, timer }

  return function subscribe(key, cb) {
    let ch = channels.get(key)
    if (!ch) {
      ch = { data: null, hasData: false, subs: new Set(), unsub: null, timer: null }
      channels.set(key, ch)
      ch.unsub = startListener(key, (data) => {
        ch.data = data
        ch.hasData = true
        for (const fn of [...ch.subs]) fn(data)
      })
    }
    if (ch.timer) {
      clearTimeout(ch.timer)
      ch.timer = null
    }
    ch.subs.add(cb)
    if (ch.hasData) cb(ch.data)

    return () => {
      ch.subs.delete(cb)
      if (ch.subs.size === 0 && !ch.timer) {
        ch.timer = setTimeout(() => {
          // Only tear down if this channel is still ours and still unused.
          if (channels.get(key) === ch && ch.subs.size === 0) {
            ch.unsub?.()
            channels.delete(key)
          }
        }, LINGER_MS)
      }
    }
  }
}
