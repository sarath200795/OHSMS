// ─────────────────────────────────────────────────────────────────────────────
// What the emails say.
//
// Pure: every function takes a record and returns { subject, text, html }.
// No Firestore, no clock, no config lookups — so the wording, the dates and the
// pluralisation are all testable, and a template change never needs a deploy to
// verify.
//
// House style, because safety mail is read on a phone in a corridor:
//   · the subject carries the fact, not the app's name
//   · the first line says what to do, the rest is context
//   · text/plain is written first and HTML mirrors it — plenty of these land in
//     Outlook rules and scanners that never render the HTML part
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "12 Aug 2026" — unambiguous for a reader who may be anywhere.
 *
 * Formatted by hand rather than with toLocaleDateString because that depends on
 * the runtime's ICU data: Node 24 renders September as "Sept" and Node 22 as
 * "Sep". Functions run on 22, this repo develops on 24, and mail that changes
 * shape depending on where it was rendered is not worth the convenience.
 */
export const fmtDate = (value) => {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value?.toDate?.() ?? value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "in 3 days" / "today" / "3 days ago" — relative to a supplied now, never Date.now(). */
export const relativeDays = (n) => {
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`
}

export const daysBetween = (from, to) => {
  const a = new Date(from), b = new Date(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  return Math.round((b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)) / 86400000)
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ── Shell ────────────────────────────────────────────────────────────────────
// One table-based layout, inline styles only. Email clients strip <style>
// blocks and have no flexbox; this renders the same in Outlook as in Gmail.
//
// Escaping happens HERE and only here. Templates below pass raw values, because
// the same values are reused verbatim in the text/plain part — escape them any
// earlier and every apostrophe reaches the reader as "Ravi&#39;s permit".
// A line value may be an array, which renders as separate rows in HTML and
// separate lines in text (the digest needs this).
const renderHtml = (v) => (Array.isArray(v) ? v.map(esc).join('<br>') : esc(v))
const renderText = (v) => (Array.isArray(v) ? v.join('\n  ') : String(v ?? ''))

const shell = ({ heading, lines, cta, footer }) => `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
 <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
   <tr><td style="font-size:17px;font-weight:600;color:#0f172a;padding-bottom:14px">${esc(heading)}</td></tr>
   ${lines
     .map(
       ([label, value]) =>
         `<tr><td style="padding:3px 0;font-size:14px;color:#475569">
            <span style="display:inline-block;min-width:104px;color:#94a3b8">${esc(label)}</span>${renderHtml(value)}
          </td></tr>`
     )
     .join('')}
   ${
     cta
       ? `<tr><td style="padding-top:22px">
            <a href="${esc(cta.href)}" style="background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">${esc(cta.label)}</a>
          </td></tr>`
       : ''
   }
   <tr><td style="padding-top:22px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;margin-top:12px">
     ${esc(footer || 'Sent by your organisation’s OHS management system.')}
   </td></tr>
  </table>
 </td></tr>
</table>`

const link = (baseUrl, path) => (baseUrl ? `${String(baseUrl).replace(/\/$/, '')}${path}` : null)

/** Assemble the two bodies from one description so they can never drift. */
const build = ({ subject, heading, lines, cta, intro, footer }) => {
  const text = [
    stripTags(intro),
    '',
    ...lines.map(([label, value]) => `${label}: ${stripTags(renderText(value))}`),
    ...(cta ? ['', `${cta.label}: ${cta.href}`] : []),
  ]
    .join('\n')
    .trim()
  return { subject, text, html: shell({ heading, lines, cta, footer }) }
}

// Record content is user input and some of it has markup pasted into it. The
// HTML part escapes; the text part drops tags rather than showing them.
const stripTags = (v) => String(v ?? '').replace(/<[^>]*>/g, '')

// ── Templates ────────────────────────────────────────────────────────────────

export function actionAssigned(action, { baseUrl, orgName, now } = {}) {
  const due = action.dueDate || action.due
  const left = due && now ? daysBetween(now, due) : null
  const urgency = left === null ? '' : left < 0 ? ' (overdue)' : left <= 2 ? ` (due ${relativeDays(left)})` : ''
  return build({
    subject: `Action assigned to you: ${action.title || action.description || 'Untitled'}${urgency}`,
    heading: 'An action has been assigned to you',
    intro: `${action.title || action.description || 'An action'} has been assigned to you${
      orgName ? ` at ${orgName}` : ''
    }.`,
    lines: [
      ['Action', action.title || action.description || '—'],
      ...(action.source ? [['Raised by', action.source]] : []),
      ...(action.site ? [['Site', action.site]] : []),
      ['Due', fmtDate(due)],
      ...(action.priority ? [['Priority', action.priority]] : []),
    ],
    cta: baseUrl ? { label: 'Open the action tracker', href: link(baseUrl, '/actions') } : null,
  })
}

export function permitExpiring(permit, { baseUrl, now } = {}) {
  const left = daysBetween(now, permit.validTo)
  return build({
    subject: `Permit ${permit.docId || permit.permitNo || ''} expires ${relativeDays(left)}`.replace(/\s+/g, ' '),
    heading: `A permit expires ${relativeDays(left)}`,
    intro: `Permit ${permit.docId || ''} (${permit.title || permit.permitType || 'work permit'}) expires ${relativeDays(
      left
    )}. Close it or request an extension.`,
    lines: [
      ['Permit', permit.docId || permit.permitNo || '—'],
      ['Title', permit.title || '—'],
      ['Type', permit.permitType || '—'],
      ['Site', permit.site || '—'],
      ['Requested by', permit.requestedBy || permit.createdByName || '—'],
      ['Valid until', fmtDate(permit.validTo)],
    ],
    cta: baseUrl ? { label: 'Open permits', href: link(baseUrl, '/ptw') } : null,
  })
}

export function trainingExpiring(record, { baseUrl, now } = {}) {
  const left = daysBetween(now, record.expiryDate)
  return build({
    subject: `Training expires ${relativeDays(left)}: ${record.title || 'certification'}`,
    heading: `A training record expires ${relativeDays(left)}`,
    intro: `${record.employee || 'An employee'}'s "${record.title || 'training'}" expires ${relativeDays(
      left
    )}. Schedule a refresher to stay compliant.`,
    lines: [
      ['Course', record.title || '—'],
      ['Employee', record.employee || '—'],
      ['Completed', fmtDate(record.completedDate)],
      ['Expires', fmtDate(record.expiryDate)],
    ],
    cta: baseUrl ? { label: 'Open training', href: link(baseUrl, '/training') } : null,
  })
}

export function incidentReported(incident, { baseUrl, orgName, siteName } = {}) {
  const sev = incident.severity ? String(incident.severity) : null
  return build({
    subject: `${sev ? `[${sev}] ` : ''}Incident reported: ${incident.refNo || incident.docId || 'new report'}`,
    heading: 'An incident has been reported',
    intro: `A ${sev ? `${sev.toLowerCase()}-severity ` : ''}incident was reported${
      siteName ? ` at ${siteName}` : ''
    }${orgName ? ` (${orgName})` : ''}.`,
    lines: [
      ['Reference', incident.refNo || incident.docId || '—'],
      ['Type', incident.type || '—'],
      ['Severity', incident.severity || '—'],
      ['Date', fmtDate(incident.incidentDate)],
      ...(siteName ? [['Site', siteName]] : []),
      ['Status', incident.lifecycle || 'reported'],
    ],
    cta: baseUrl ? { label: 'Review the incident', href: link(baseUrl, '/incidents') } : null,
  })
}

export function unsafeObservation(observation, { baseUrl, permit } = {}) {
  return build({
    subject: `Unsafe observation on permit ${observation.permitNo || permit?.docId || ''}`.trim(),
    heading: 'An unsafe condition was reported against an open permit',
    intro:
      `Someone scanning permit ${observation.permitNo || permit?.docId || ''} reported an unsafe condition. ` +
      `The permit is flagged until this is reviewed.`,
    lines: [
      ['Permit', observation.permitNo || permit?.docId || '—'],
      ...(permit?.title ? [['Work', permit.title]] : []),
      ...(permit?.site ? [['Site', permit.site]] : []),
      ['Observation', observation.note || '—'],
      ['Reported by', observation.observedByName || 'a QR scan'],
      ['Source', observation.source === 'public' ? 'public QR scan' : observation.source || 'app'],
    ],
    cta: baseUrl ? { label: 'Review the permit', href: link(baseUrl, '/ptw') } : null,
    footer: 'Reported by scanning the permit QR code — the reporter may not have an account.',
  })
}

/**
 * The daily digest.
 *
 * Deliberately returns null when there is nothing to say. A digest that arrives
 * every morning reading "0 items" is the fastest way to train an organisation
 * to filter these into a folder they never open.
 */
export function digest({ permits = [], training = [], actions = [] }, { baseUrl, orgName, now } = {}) {
  const total = permits.length + training.length + actions.length
  if (!total) return null

  // Hand the renderer an array, not a <br>-joined string: values are escaped at
  // render time now, so a literal tag here would reach the reader as "&lt;br&gt;".
  const section = (title, items, render) => (items.length ? [[title, items.map(render)]] : [])

  return build({
    subject: `OHS digest — ${plural(total, 'item')} need attention`,
    heading: `${orgName || 'Your organisation'} — items needing attention`,
    intro: `${plural(total, 'item')} need attention today.`,
    lines: [
      ...section('Permits', permits, (p) =>
        `${p.docId || p.title || 'permit'} — expires ${fmtDate(p.validTo)}`
      ),
      ...section('Training', training, (t) =>
        `${t.employee || 'employee'} · ${t.title || 'course'} — expires ${fmtDate(t.expiryDate)}`
      ),
      ...section('Actions', actions, (a) => {
        const left = a.dueDate && now ? daysBetween(now, a.dueDate) : null
        return `${a.title || 'action'}${left === null ? '' : ` — due ${relativeDays(left)}`}`
      }),
    ],
    cta: baseUrl ? { label: 'Open the portal', href: link(baseUrl, '/') } : null,
    // Points at the opt-out that exists. The mail tier honours
    // notificationsEnabled on the user record, but nothing in the app writes it
    // — there is no preferences screen — so promising one sends a reader
    // hunting through their profile for a switch that was never built, and the
    // ones who give up learn to filter the sender instead.
    footer: 'Daily digest. To stop receiving it, ask your OHS administrator.',
  })
}
