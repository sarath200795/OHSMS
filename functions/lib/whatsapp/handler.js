// ─────────────────────────────────────────────────────────────────────────────
// One inbound message, start to finish — with every side effect behind `ctx`
// so the decisions can be tested without Firestore or Meta.
//
// Order matters and is the security argument:
//
//   1  dedupe        claim the wamid; a Meta retry must not be a second
//                    (billable) reply
//   2  LINK          the only command an unlinked number may use
//   3  sender        waLinks → /users live re-check (approved, same org, own
//                    password). Unknown or inactive: one polite reply per 24 h,
//                    no data, and never a hint whether a site exists
//   4  UNLINK        honoured before the rate limit: withdrawing consent must
//                    always work
//   5  rate limit    30/h, 150/day
//   6  resolve       ONLY among the sites the user reaches (resolve.js)
//   7  reply         snapshot counts + contacts, one message
//   8  log           waQueryLog: outcome and site id, never the message text
//
// ctx = {
//   now: Date,
//   store: {
//     claimInbound(wamid) → bool                  first time seen?
//     getLink(waId) → { uid, orgId } | null
//     getUser(uid) → profile | null
//     redeemLinkCode(code, waId) → { ok, uid?, orgId?, reason? }
//     unlink(waId)
//     rate(waId, fn) → fn's result                runs fn(state) → { state, ...out } in a transaction
//     listSites(orgId) → sites[]
//     siteCounts(orgId) → { asOf: Date, sites: { [siteId]: counts } }
//     siteContext(orgId, site) → { contacts, helplinePrimary, helplineSecondary, roleLabels, modules }
//     getSession(waId) / setSession(waId, { uid, orgId, choices, expiresAtMs }) / clearSession(waId)
//     log(row, waId)                              waId is hashed, never stored
//   },
//   reply(to, { text } | { text, rows } | { text, locationRequest }) → bool   false when the breaker or Graph refused
// }
// ─────────────────────────────────────────────────────────────────────────────
import { parseCommand } from './parse.js'
import { isActiveMember, reachableSites } from './access.js'
import { resolveSiteQuery } from './resolve.js'
import { countQuery, allowUnlinkedReply, linkBlocked, countBadLink } from './rateLimit.js'
import {
  formatSiteReply,
  formatChoices,
  formatNearby,
  locationRequestText,
  MESSAGES,
  tooMany,
  helpText,
} from './format.js'
import { nearestSites, formatKm } from './geo.js'

/** Messages older than this are not answered: the reply would be stale and the window may have closed. */
export const MAX_MESSAGE_AGE_MS = 60 * 60 * 1000

/** How long a numbered list stays answerable by its numbers. */
export const SESSION_TTL_MS = 15 * 60 * 1000

/**
 * The site a numbered reply picks from the user's last list, or undefined
 * when there is no live list (so the text is treated as a code instead).
 * Returns null when the list exists but the pick is no longer in reach.
 */
export function pickFromSession(session, uid, n, reach, now) {
  if (!session || session.uid !== uid) return undefined
  if (!(Number(session.expiresAtMs) > now.getTime())) return undefined
  const ids = Array.isArray(session.choices) ? session.choices : []
  if (!Number.isInteger(n) || n < 1 || n > ids.length) return undefined
  return reach.find((s) => s.id === ids[n - 1]) || null
}

export async function handleMessage(msg, ctx) {
  const { store, now = new Date() } = ctx
  const from = msg.from
  const cmd = parseCommand(msg)
  const row = { orgId: null, uid: null, siteId: null, intent: cmd.kind, outcome: 'ok' }
  const done = async (outcome, extra = {}) => {
    Object.assign(row, extra, { outcome })
    await store.log(row, from)
    return row
  }

  if (!(await store.claimInbound(msg.wamid))) return { ...row, outcome: 'duplicate' }
  if (msg.timestamp && now.getTime() - msg.timestamp * 1000 > MAX_MESSAGE_AGE_MS)
    return done('stale')

  // ── LINK ──────────────────────────────────────────────────────────────────
  if (cmd.kind === 'link' || cmd.kind === 'badLink') {
    const blocked = await store.rate(from, (s) => ({ state: s, blocked: linkBlocked(s, now) }))
    if (blocked.blocked) return done('blocked')
    if (cmd.kind === 'badLink') {
      await ctx.reply(from, { text: MESSAGES.badLink })
      return done('badlink')
    }
    const result = await store.redeemLinkCode(cmd.code, from)
    if (!result.ok) {
      const after = await store.rate(from, (s) => countBadLink(s, now))
      await ctx.reply(from, { text: after.blocked ? MESSAGES.linkBlocked : MESSAGES.linkFailed })
      return done('linkfailed')
    }
    await ctx.reply(from, { text: MESSAGES.linked })
    return done('linked', { orgId: result.orgId, uid: result.uid })
  }

  // ── Who is this? ──────────────────────────────────────────────────────────
  const link = await store.getLink(from)
  const user = link ? await store.getUser(link.uid) : null
  if (!link || !isActiveMember(user, link.orgId)) {
    if (cmd.kind === 'unlink' && link) await store.unlink(from)
    const gate = await store.rate(from, (s) => allowUnlinkedReply(s, now))
    if (gate.reply) await ctx.reply(from, { text: MESSAGES.unlinked })
    return done(link ? 'denied' : 'unknown', link ? { orgId: link.orgId, uid: link.uid } : {})
  }
  Object.assign(row, { orgId: link.orgId, uid: link.uid })
  // Remember a list so "2" can answer it. Site ids only, 15 minutes.
  const offer = (sites) =>
    store.setSession(from, {
      uid: link.uid,
      orgId: link.orgId,
      choices: sites.slice(0, 10).map((s) => s.id),
      expiresAtMs: now.getTime() + SESSION_TTL_MS,
    })

  if (cmd.kind === 'unlink') {
    await store.unlink(from)
    await ctx.reply(from, { text: MESSAGES.unlinkedOk })
    return done('unlinked')
  }

  const limit = await store.rate(from, (s) => countQuery(s, now))
  if (limit.verdict !== 'ok') {
    if (limit.verdict === 'notify') await ctx.reply(from, { text: MESSAGES.slowDown })
    return done('ratelimited')
  }

  const reach = reachableSites(user, await store.listSites(link.orgId))
  if (!reach.length) {
    await ctx.reply(from, { text: MESSAGES.noSites })
    return done('nosites')
  }

  let site = null
  if (cmd.kind === 'help' || (cmd.kind === 'greeting' && reach.length !== 1)) {
    await ctx.reply(from, { text: helpText(reach) })
    return done('help')
  }
  if (cmd.kind === 'greeting') site = reach[0]
  else if (cmd.kind === 'choice') {
    site = reach.find((s) => s.id === cmd.siteId) || null
    if (!site) {
      await ctx.reply(from, { text: MESSAGES.noAccess })
      return done('denied')
    }
  } else if (cmd.kind === 'badLocation') {
    await ctx.reply(from, { text: MESSAGES.badLocation })
    return done('badlocation')
  } else if (cmd.kind === 'location') {
    // The coordinates are used here and nowhere else: not logged, not stored,
    // not put in the session (which keeps only the site ids it offered).
    const near = nearestSites(reach, cmd.latitude, cmd.longitude)
    if (!near.sites.length) {
      await ctx.reply(from, { text: MESSAGES.noLocatedSites })
      return done('nolocated')
    }
    await offer(near.sites.map((x) => x.site))
    const { text, rows } = formatNearby(near.sites, near.within, formatKm)
    await ctx.reply(from, { text, rows })
    return done('nearby')
  } else {
    // A bare number answers the last list, if one is live; otherwise it is a code.
    if (/^\d{1,2}$/.test(cmd.query)) {
      const picked = pickFromSession(
        await store.getSession(from),
        link.uid,
        Number(cmd.query),
        reach,
        now
      )
      if (picked === null) {
        await ctx.reply(from, { text: MESSAGES.noAccess })
        return done('denied')
      }
      if (picked) site = picked
    }
    if (!site) {
      const hit = resolveSiteQuery(cmd.query, reach)
      if (hit.status === 'none') {
        // Cannot name it? Then show where they are. Interactive location
        // request where the client supports it, plain instructions otherwise.
        await ctx.reply(from, { text: locationRequestText(cmd.query), locationRequest: true })
        return done('nomatch')
      }
      if (hit.status === 'tooMany') {
        await ctx.reply(from, { text: tooMany(hit.count) })
        return done('ambiguous')
      }
      if (hit.status === 'many') {
        await offer(hit.sites)
        const { text, rows } = formatChoices(hit.sites, cmd.query)
        await ctx.reply(from, { text, rows })
        return done('ambiguous')
      }
      site = hit.site
    }
  }

  try {
    const [snap, extra] = await Promise.all([
      store.siteCounts(link.orgId),
      store.siteContext(link.orgId, site),
    ])
    const text = formatSiteReply(site, snap.sites?.[site.id] || {}, { ...extra, asOf: snap.asOf })
    await ctx.reply(from, { text })
    return done('ok', { siteId: site.id })
  } catch (err) {
    await ctx.reply(from, { text: MESSAGES.error })
    return done('error', { siteId: site.id, error: String(err?.message || err).slice(0, 200) })
  }
}
