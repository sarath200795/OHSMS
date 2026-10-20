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
//   6  organisation  only the live profile's org. No site is searched until
//                    the chat has chosen one (remembered for 24 h idle)
//   7  resolve       ONLY among the sites the user reaches in that org
//   8  reply         snapshot counts + contacts, one message
//   9  log           waQueryLog: outcome and site id, never the message text
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
//     getOrganization(orgId) → { id, name } | null
//     getSession(waId) / setSession(waId, session) / clearSession(waId)
//       session: { uid, orgId, step, choiceKind, choices, choicesExpireAtMs, expiresAtMs }
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
import {
  CONV_TTL_MS,
  ORG_NONE,
  ORG_NOT_ALLOWED,
  ORG_TOO_MANY,
  callerForOrg,
  formatOrgPrompt,
  onSiteStep,
  orgsForLinkedUser,
  pickListedOrg,
  resolveOrgQuery,
  shouldListOrgs,
  sitePrompt,
} from './orgs.js'

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
  // An organisation list is not a site list. A number there is answered by
  // guideConversation, and falling through would treat "1" as a site code.
  if (session.choiceKind === 'org' || session.step === 'org') return undefined
  const nowMs = now.getTime()
  const choiceExpiry =
    session.choicesExpireAtMs != null
      ? Number(session.choicesExpireAtMs)
      : Number(session.expiresAtMs)
  if (!(choiceExpiry > nowMs)) return undefined
  // expiresAtMs is the conversation. Once it has passed, the list goes with it.
  if (session.choicesExpireAtMs != null && !(Number(session.expiresAtMs) > nowMs)) return undefined
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
    if (cmd.kind === 'unlink' && link) {
      await store.unlink(from)
      if (store.clearSession) await store.clearSession(from)
    }
    const gate = await store.rate(from, (s) => allowUnlinkedReply(s, now))
    if (gate.reply) await ctx.reply(from, { text: MESSAGES.unlinked })
    return done(link ? 'denied' : 'unknown', link ? { orgId: link.orgId, uid: link.uid } : {})
  }
  Object.assign(row, { orgId: link.orgId, uid: link.uid })

  if (cmd.kind === 'unlink') {
    await store.unlink(from)
    if (store.clearSession) await store.clearSession(from)
    await ctx.reply(from, { text: MESSAGES.unlinkedOk })
    return done('unlinked')
  }

  const limit = await store.rate(from, (s) => countQuery(s, now))
  if (limit.verdict !== 'ok') {
    if (limit.verdict === 'notify') await ctx.reply(from, { text: MESSAGES.slowDown })
    return done('ratelimited')
  }

  // The live organisation document, not the name copied onto the profile at
  // signup. A deleted organisation is not offered. Tests that stub no
  // getOrganization still resolve the one org on the profile.
  let orgs = []
  if (typeof store.getOrganization === 'function') {
    const record = await store.getOrganization(user.orgId)
    orgs = record ? orgsForLinkedUser(user, record) : []
  } else {
    orgs = orgsForLinkedUser(user, { id: user.orgId, name: user.orgName || '' })
  }
  const out = await guideConversation(cmd, {
    store,
    reply: ctx.reply,
    now,
    from,
    user,
    uid: link.uid,
    orgs,
    // These names are the caller's own organisations, not the customer list.
    listOrgs: true,
  })
  return done(out.outcome, { ...(out.extra || {}), orgId: out.extra?.orgId || link.orgId })
}

/**
 * The lookup itself, shared by every channel (WhatsApp here, Telegram in
 * ../telegram/handler.js): once the caller is known to be allowed, resolve the
 * command ONLY among the sites `user` reaches and send one reply.
 * Returns { outcome, extra? } for the query log. `from` keys the pick-list session.
 */
export async function answerQuery(cmd, { store, reply, now = new Date(), from, user, orgId, uid }) {
  // Remember a list so "2" can answer it. Site ids only. The number works for
  // 15 minutes; the document itself keeps the chosen organisation until the
  // conversation times out (CONV_TTL_MS), so the two clocks are not one field.
  const offer = (sites) =>
    store.setSession(from, {
      uid: uid,
      orgId: orgId,
      lastOrgId: orgId,
      step: 'site',
      choiceKind: 'site',
      choices: sites.slice(0, 10).map((s) => s.id),
      choicesExpireAtMs: now.getTime() + SESSION_TTL_MS,
      expiresAtMs: now.getTime() + CONV_TTL_MS,
    })
  const reach = reachableSites(user, await store.listSites(orgId))
  if (!reach.length) {
    await reply(from, { text: MESSAGES.noSites })
    return { outcome: 'nosites' }
  }

  let site = null
  if (cmd.kind === 'help' || (cmd.kind === 'greeting' && reach.length !== 1)) {
    await reply(from, { text: helpText(reach) })
    return { outcome: 'help' }
  }
  if (cmd.kind === 'greeting') site = reach[0]
  else if (cmd.kind === 'choice') {
    site = reach.find((s) => s.id === cmd.siteId) || null
    if (!site) {
      await reply(from, { text: MESSAGES.noAccess })
      return { outcome: 'denied' }
    }
  } else if (cmd.kind === 'badLocation') {
    await reply(from, { text: MESSAGES.badLocation })
    return { outcome: 'badlocation' }
  } else if (cmd.kind === 'location') {
    // The coordinates are used here and nowhere else: not logged, not stored,
    // not put in the session (which keeps only the site ids it offered).
    const near = nearestSites(reach, cmd.latitude, cmd.longitude)
    if (!near.sites.length) {
      await reply(from, { text: MESSAGES.noLocatedSites })
      return { outcome: 'nolocated' }
    }
    await offer(near.sites.map((x) => x.site))
    const { text, rows } = formatNearby(near.sites, near.within, formatKm)
    await reply(from, { text, rows })
    return { outcome: 'nearby' }
  } else {
    // A bare number answers the last list, if one is live; otherwise it is a code.
    if (/^\d{1,2}$/.test(cmd.query)) {
      const picked = pickFromSession(
        await store.getSession(from),
        uid,
        Number(cmd.query),
        reach,
        now
      )
      if (picked === null) {
        await reply(from, { text: MESSAGES.noAccess })
        return { outcome: 'denied' }
      }
      if (picked) site = picked
    }
    if (!site) {
      const hit = resolveSiteQuery(cmd.query, reach)
      if (hit.status === 'none') {
        // Cannot name it? Then show where they are. Interactive location
        // request where the client supports it, plain instructions otherwise.
        await reply(from, { text: locationRequestText(cmd.query), locationRequest: true })
        return { outcome: 'nomatch' }
      }
      if (hit.status === 'tooMany') {
        await reply(from, { text: tooMany(hit.count) })
        return { outcome: 'ambiguous' }
      }
      if (hit.status === 'many') {
        await offer(hit.sites)
        const { text, rows } = formatChoices(hit.sites, cmd.query)
        await reply(from, { text, rows })
        return { outcome: 'ambiguous' }
      }
      site = hit.site
    }
  }

  try {
    const [snap, extra] = await Promise.all([
      store.siteCounts(orgId),
      store.siteContext(orgId, site),
    ])
    const text = formatSiteReply(site, snap.sites?.[site.id] || {}, { ...extra, asOf: snap.asOf })
    await reply(from, { text })
    return { outcome: 'ok', extra: { siteId: site.id } }
  } catch (err) {
    await reply(from, { text: MESSAGES.error })
    return {
      outcome: 'error',
      extra: { siteId: site.id, error: String(err?.message || err).slice(0, 200) },
    }
  }
}

/**
 * Ask which organisation, then which site. Shared by WhatsApp and Telegram.
 *
 * Nothing about a site is read until the chat is on the site step for an
 * organisation this caller may use. `listOrgs` is the only switch that
 * volunteers more than one name; a single allowed organisation is named
 * because hiding the only choice does not protect a directory.
 *
 * The last organisation is the session's `step: 'site'` until `expiresAtMs`
 * (CONV_TTL_MS, refreshed on each site message). MENU and CHANGE ORG clear
 * that step. A numbered organisation list dies at choicesExpireAtMs, which
 * is the same 15 minutes as a site list, and is not the conversation clock.
 */
export async function guideConversation(cmd, ctx) {
  const { store, reply, now = new Date(), from, user, uid, orgs, listOrgs = false } = ctx
  const allowed = (orgs || []).filter((o) => o && o.id && String(o.name || '').trim())
  const finish = (outcome, extra = {}) => ({ outcome, extra: { intent: 'org', ...extra } })

  const ask = async (choices, { list, query = '', missed = false, ambiguous = false } = {}) => {
    const prompt = formatOrgPrompt(choices, { list, query, missed })
    const shown = list ? choices.slice(0, 10) : []
    await store.setSession(from, {
      uid: uid ?? null,
      orgId: null,
      lastOrgId: null,
      step: 'org',
      choiceKind: shown.length ? 'org' : null,
      choices: shown.map((o) => o.id),
      choicesExpireAtMs: now.getTime() + SESSION_TTL_MS,
      expiresAtMs: now.getTime() + CONV_TTL_MS,
    })
    await reply(from, { text: prompt.text, rows: prompt.rows, list: prompt.list })
    return finish(ambiguous ? 'ambiguous' : missed ? 'nomatch' : 'orgprompt')
  }

  const commit = async (org) => {
    await store.setSession(from, {
      uid: uid ?? null,
      orgId: org.id,
      lastOrgId: org.id,
      step: 'site',
      choiceKind: null,
      choices: [],
      choicesExpireAtMs: 0,
      expiresAtMs: now.getTime() + CONV_TTL_MS,
    })
    await reply(from, { text: sitePrompt(org) })
    return finish('orgselected', { orgId: org.id })
  }

  if (!allowed.length) {
    await reply(from, { text: ORG_NONE })
    return finish('noorgs')
  }

  if (cmd.kind === 'menu' || cmd.kind === 'changeOrg') {
    return ask(allowed, { list: shouldListOrgs(allowed, listOrgs) })
  }

  const session = typeof store.getSession === 'function' ? await store.getSession(from) : null
  const current = onSiteStep(session, uid ?? null, allowed, now)

  if (cmd.kind === 'choice' && cmd.choiceKind === 'org') {
    const picked = allowed.find((o) => o.id === cmd.orgId)
    if (!picked) {
      await reply(from, { text: ORG_NOT_ALLOWED })
      return finish('denied')
    }
    return commit(picked)
  }

  if (current) {
    const siteList = session.choiceKind === 'site'
    await store.setSession(from, {
      uid: uid ?? null,
      orgId: current.id,
      lastOrgId: current.id,
      step: 'site',
      choiceKind: siteList ? 'site' : null,
      choices: siteList ? session.choices || [] : [],
      choicesExpireAtMs: siteList ? Number(session.choicesExpireAtMs) || 0 : 0,
      expiresAtMs: now.getTime() + CONV_TTL_MS,
    })
    const caller = callerForOrg(user, current.id)
    if (!caller) {
      await reply(from, { text: ORG_NOT_ALLOWED })
      return finish('denied', { orgId: current.id })
    }
    const out = await answerQuery(cmd, {
      store,
      reply,
      now,
      from,
      user: caller,
      orgId: current.id,
      uid,
    })
    return { outcome: out.outcome, extra: { ...(out.extra || {}), orgId: current.id } }
  }

  // No organisation chosen yet. A site id, a location or a site-row tap is
  // not searched: answering it would confirm which sites exist in which org.
  if (cmd.kind === 'site' && /^\d{1,2}$/.test(cmd.query || '')) {
    const picked = pickListedOrg(session, uid ?? null, Number(cmd.query), allowed, now)
    if (picked === null) {
      await reply(from, { text: ORG_NOT_ALLOWED })
      return finish('denied')
    }
    if (picked) return commit(picked)
  }

  if (cmd.kind === 'site') {
    const hit = resolveOrgQuery(cmd.query, allowed)
    if (hit.status === 'one') return commit(hit.org)
    if (hit.status === 'many')
      return ask(hit.orgs, { list: true, query: cmd.query, ambiguous: true })
    if (hit.status === 'tooMany') {
      await reply(from, { text: ORG_TOO_MANY })
      return finish('ambiguous')
    }
    return ask(allowed, {
      list: shouldListOrgs(allowed, listOrgs),
      query: cmd.query,
      missed: true,
    })
  }

  return ask(allowed, { list: shouldListOrgs(allowed, listOrgs) })
}
