// ─────────────────────────────────────────────────────────────────────────────
// One inbound message, start to finish — with every side effect behind `ctx`
// so the decisions can be tested without Firestore or Meta.
//
// Order matters and is the security argument:
//
//   1  dedupe        claim the wamid; a Meta retry must not be a second
//                    (billable) reply
//   2  LINK          the only command an unlinked number may use. Success
//                    writes waLinks and does not reply: notifyWhatsAppLinked
//                    sends the one welcome. A reply here as well billed a
//                    second message, and a Graph refusal on that reply was
//                    easy to mistake for the link having failed.
//   3  sender        waLinks → /users live re-check (approved, same org, own
//                    password). Unknown or inactive: a reply that says how to
//                    get access, every time, no data, and never a hint whether
//                    a site exists. One reply a day then silence was the old
//                    gate; a linked number that missed the document id then
//                    looked dead.
//   4  UNLINK        honoured before the rate limit: withdrawing consent must
//                    always work, including when the organisation has switched
//                    lookup off
//   5  org switch    waOrgSettings enabled === false stops the reply before
//                    any site is read. A missing document leaves lookup on
//   6  rate limit    30/h, 150/day
//   7  organisation  one allowed org is already known (the link, or a bot
//                    pinned to one). A greeting is the centre prompt; a
//                    centre id, a name or a location is answered immediately,
//                    still only among sites the caller reaches. Several
//                    names still ask first (24 h idle). MENU / CHANGE ORG
//                    ask again, and a numbered reply is that list.
//   8  resolve       exact Centre ID, then partial/fuzzy name, ONLY among
//                    the sites the user reaches in that org
//   9  reply         one match: the snapshot. Several (at most 8): a numbered
//                    list. None: not found, plus the closest names
//  10  log           waQueryLog: outcome and site id, never the message text
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
import { closestSites, resolveSiteQuery, MAX_CHOICES } from './resolve.js'
import { countQuery, linkBlocked, countBadLink } from './rateLimit.js'
import {
  formatSiteReply,
  formatChoices,
  formatNearby,
  formatNotFound,
  formatCachedAudit,
  MESSAGES,
  tooMany,
  helpText,
  DETAIL_QUESTION,
  DETAIL_BUTTONS,
  DETAIL_DECLINED,
  DETAIL_EXPIRED,
  CONTACT_ADMIN,
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
 * The live Yes/No offer, or null. A different person, a different
 * organisation, or a clock that has passed is not an offer: "yes" is then
 * a centre search, which is how a centre whose name is Yes still resolves
 * once the question has gone.
 */
export function liveDetailOffer(session, { uid, orgId, now }) {
  const offer = session?.detailOffer
  if (!offer || typeof offer !== 'object') return null
  if (session.uid !== uid) return null
  if (offer.orgId !== orgId) return null
  if (typeof offer.siteId !== 'string' || !offer.siteId || offer.siteId.includes('/')) return null
  if (typeof offer.orgId !== 'string' || offer.orgId.includes('/')) return null
  if (!(Number(offer.expireAtMs) > now.getTime())) return null
  return { siteId: offer.siteId, orgId: offer.orgId, expireAtMs: Number(offer.expireAtMs) }
}

/**
 * 'yes' or 'no' when this message answers the audit question.
 * A button always does. The words do only while an offer is live, so a
 * centre named Yes is still a centre when nobody was asked.
 */
export function auditReply(cmd, offer) {
  if (cmd?.kind === 'audit') return cmd.answer === 'no' ? 'no' : 'yes'
  if (!offer || cmd?.kind !== 'site') return null
  if (cmd.query === 'yes') return 'yes'
  if (cmd.query === 'no') return 'no'
  return null
}

function siteSession({
  uid,
  orgId,
  now,
  choiceKind = null,
  choices = [],
  choicesExpireAtMs = 0,
  detailOffer = null,
}) {
  return {
    uid: uid ?? null,
    orgId,
    lastOrgId: orgId,
    step: 'site',
    choiceKind,
    choices,
    choicesExpireAtMs,
    expiresAtMs: now.getTime() + CONV_TTL_MS,
    detailOffer,
  }
}

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
    // The welcome is the waLinks trigger, not this reply. Redeem has already
    // committed. Replying here sent a second text, and still would on the
    // re-save of a binding the trigger correctly stays quiet for.
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
    // Always answer. The previous one-reply-a-day gate left a handset silent
    // after a single unknown, including one whose link was stored under a
    // different spelling of the same number. The daily outbound cap in the
    // webhook is what still stops a flood.
    await ctx.reply(from, { text: MESSAGES.unlinked })
    return done(link ? 'denied' : 'unknown', link ? { orgId: link.orgId, uid: link.uid } : {})
  }
  Object.assign(row, { orgId: link.orgId, uid: link.uid })

  if (cmd.kind === 'unlink') {
    await store.unlink(from)
    if (store.clearSession) await store.clearSession(from)
    await ctx.reply(from, { text: MESSAGES.unlinkedOk })
    return done('unlinked')
  }

  // Explicit false only. Stores that predate the switch have no method, and
  // a missing settings document is reported as on — see orgLookupEnabled.
  if (
    typeof store.orgLookupEnabled === 'function' &&
    (await store.orgLookupEnabled(link.orgId)) === false
  ) {
    await ctx.reply(from, { text: MESSAGES.orgOff })
    return done('org-off')
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
      choices: sites.slice(0, MAX_CHOICES).map((s) => s.id),
      choicesExpireAtMs: now.getTime() + SESSION_TTL_MS,
      expiresAtMs: now.getTime() + CONV_TTL_MS,
    })
  const reach = reachableSites(user, await store.listSites(orgId))
  if (!reach.length) {
    await reply(from, { text: MESSAGES.noSites })
    return { outcome: 'nosites' }
  }

  let site = null
  // Greeting is the centre prompt, sent by guideConversation before this runs.
  // Help stays a description. Neither one is a lookup: answering "hi" with
  // the only centre skipped the prompt the caller was just shown.
  if (cmd.kind === 'help' || cmd.kind === 'greeting') {
    await reply(from, { text: helpText(reach) })
    return { outcome: 'help' }
  }
  if (cmd.kind === 'choice') {
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
    const { text, rows, list } = formatNearby(near.sites, near.within, formatKm)
    await reply(from, { text, rows, list })
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
        // A miss used to ask for a location before saying the centre was not
        // found. The closest reachable names answer more often, and a shared
        // location is still accepted when the caller sends one.
        const suggestions = closestSites(cmd.query, reach)
        if (suggestions.length) await offer(suggestions)
        const { text, rows, list } = formatNotFound(cmd.query, suggestions)
        await reply(from, { text, rows, list })
        return { outcome: 'nomatch' }
      }
      if (hit.status === 'tooMany') {
        await reply(from, { text: tooMany(hit.count) })
        return { outcome: 'ambiguous' }
      }
      if (hit.status === 'many') {
        await offer(hit.sites)
        const { text, rows, list } = formatChoices(hit.sites, cmd.query)
        await reply(from, { text, rows, list })
        return { outcome: 'ambiguous' }
      }
      site = hit.site
    }
  }

  try {
    // No Metabase read here. The last-audit block used to be part of this
    // reply, and a warehouse that never answered held the only message for
    // the whole deadline. The summary is the snapshot and the contact
    // directory. The audit, if they ask, is the cache the schedule wrote.
    const [snap, extra] = await Promise.all([
      store.siteCounts(orgId),
      store.siteContext(orgId, site),
    ])
    const text = formatSiteReply(site, snap.sites?.[site.id] || {}, {
      ...extra,
      asOf: snap.asOf,
    })
    await reply(from, { text })
    // The question is a second message on purpose. The summary must not wait
    // on the warehouse, and the audit is opt-in. Fifteen minutes, same clock
    // as a numbered list. A new lookup replaces this; MENU drops it because
    // that setSession does not pass detailOffer.
    await store.setSession(
      from,
      siteSession({
        uid,
        orgId,
        now,
        detailOffer: {
          siteId: site.id,
          orgId,
          expireAtMs: now.getTime() + SESSION_TTL_MS,
        },
      })
    )
    await reply(from, { text: DETAIL_QUESTION, buttons: DETAIL_BUTTONS })
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
 * Yes reads the schedule's cache. No is a short acknowledgement. Neither
 * path imports Metabase: a missing document is CONTACT_ADMIN, not a fetch.
 * Reach is checked again, against the sites this caller can see now.
 */
async function answerDetail({ store, reply, now, from, user, uid, org, offer, answer }) {
  await store.setSession(from, siteSession({ uid, orgId: org.id, now, detailOffer: null }))
  if (!offer) {
    await reply(from, { text: DETAIL_EXPIRED })
    return { outcome: 'expired', extra: { orgId: org.id } }
  }
  if (answer === 'no') {
    await reply(from, { text: DETAIL_DECLINED })
    return { outcome: 'declined', extra: { orgId: org.id, siteId: offer.siteId } }
  }
  const caller = callerForOrg(user, org.id)
  const reach = caller ? reachableSites(caller, await store.listSites(org.id)) : []
  const site = reach.find((s) => s.id === offer.siteId) || null
  if (!site) {
    await reply(from, { text: MESSAGES.noAccess })
    return { outcome: 'denied', extra: { orgId: org.id } }
  }
  let record = null
  try {
    if (typeof store.getSiteAuditCache === 'function') {
      record = await store.getSiteAuditCache(org.id, site.id)
    }
  } catch {
    record = null
  }
  const text = formatCachedAudit(record)
  await reply(from, { text: text || CONTACT_ADMIN })
  return {
    outcome: text ? 'audit' : 'nocache',
    extra: { orgId: org.id, siteId: site.id },
  }
}

/**
 * Ask which organisation, then which site. Shared by WhatsApp and Telegram.
 *
 * One allowed organisation is already known — the link, or a bot pinned to
 * one — so a greeting is the centre prompt, and a centre id, a name or a
 * location is resolved immediately, still only among sites `reachableSites`
 * returns. Several organisations still ask first. A site answered before
 * that choice would confirm which organisation holds it. `listOrgs` is the
 * only switch that volunteers more than one name. MENU and CHANGE ORG ask
 * again even when there is only one, and a live organisation list is
 * answered before a single organisation is assumed — "1" after MENU is the
 * list, not a centre id.
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
  let current = onSiteStep(session, uid ?? null, allowed, now)

  if (cmd.kind === 'choice' && cmd.choiceKind === 'org') {
    const picked = allowed.find((o) => o.id === cmd.orgId)
    if (!picked) {
      await reply(from, { text: ORG_NOT_ALLOWED })
      return finish('denied')
    }
    return commit(picked)
  }

  // A number answers the organisation list while that list is the question
  // in front of them. It has to run before the single-org shortcut, or "1"
  // would be read as a centre id.
  if (!current && cmd.kind === 'site' && /^\d{1,2}$/.test(cmd.query || '')) {
    const picked = pickListedOrg(session, uid ?? null, Number(cmd.query), allowed, now)
    if (picked === null) {
      await reply(from, { text: ORG_NOT_ALLOWED })
      return finish('denied')
    }
    if (picked) return commit(picked)
  }

  // A linked profile belongs to one organisation, and a pinned bot has one.
  // That organisation is already known, so the message is a centre — unless
  // this chat is still answering the organisation list (MENU / CHANGE ORG).
  // Treating the name they were just asked for as a centre search missed,
  // and then suggested centres.
  const orgQuestion =
    session &&
    session.uid === (uid ?? null) &&
    session.step === 'org' &&
    Number(session.expiresAtMs) > now.getTime()
  if (!current && !orgQuestion && allowed.length === 1) current = allowed[0]

  if (current && cmd.kind === 'greeting') return commit(current)

  if (current) {
    const offer = liveDetailOffer(session, { uid: uid ?? null, orgId: current.id, now })
    const answer = auditReply(cmd, offer)
    if (answer) {
      const caller = callerForOrg(user, current.id)
      if (!caller) {
        await reply(from, { text: ORG_NOT_ALLOWED })
        return finish('denied', { orgId: current.id })
      }
      const out = await answerDetail({
        store,
        reply,
        now,
        from,
        user: caller,
        uid,
        org: current,
        offer,
        answer,
      })
      return { outcome: out.outcome, extra: { ...(out.extra || {}), orgId: current.id } }
    }
    const siteList = session?.choiceKind === 'site' && session.orgId === current.id
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

  // No organisation chosen yet, and more than one is possible. A site id is
  // not searched: answering it would confirm which sites exist in which org.
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

  if (cmd.kind === 'audit') {
    await reply(from, { text: DETAIL_EXPIRED })
    return finish('expired')
  }

  return ask(allowed, { list: shouldListOrgs(allowed, listOrgs) })
}
