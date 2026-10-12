# WhatsApp site lookup

A linked, approved app user sends a site code or name to the organisation's
WhatsApp Business number and gets **one message** back with that site's safety
summary. Provider: Meta WhatsApp Cloud API, directly (no BSP). Operational
details of the live deployment — the number, the project, the callback URL —
belong in the private runbook, not here (AGENTS.md, "This repository is public").

## What the reply contains

```
🏢 *Demo Fitness Central (DEMO001)*
South · Demo Co

🧯 Fire extinguishers: 6 (1 HPT overdue)
⚠️ Open defects: 3 (2 extinguisher, 1 AED)
🩹 First aid boxes: 2
📋 Pending actions: 4 (1 overdue)
🚑 Incidents: 7 total · 1 open · 2 in last 90 days

📞 *Emergency contacts*
• Police: Demo Police Station — 100
• Site Head: Asha Example — +91 90000 00001

☎️ Safety helpline: 1800 000 0000
🚨 National emergency: 112

Updated 12 Oct, 07:30 IST
Reply with another site code or name.
```

| Line | Definition (and the app helper it must equal) |
|---|---|
| Fire extinguishers | Admin → Sites (`siteStats().extinguishers`); HPT overdue = `deriveStatus().flags.HPT_DUE` on a unit not closed |
| Open defects | The Defect Repository: approved physical-defect reports still on the unit, derived **HPT due** and **Empty** rows, and pending AED / fire-alarm QR reports |
| First aid boxes | `sites/{id}.firstAidBoxes` |
| Pending actions | The Central Action Tracker **minus** the equipment source (already counted as defects) and **minus** illness actions; incidents, drills, inspections and internal audit only; overdue = due date before today (IST); "none" when zero |
| Incidents | `siteStats` matching; open = lifecycle not closed / verified; last 90 days by incident date |
| Emergency contacts | `erpContacts` for the site plus org-wide ones, external services first; the org helpline; 112 |

`functions/` cannot import `src/`, so the definitions are ported to
`functions/lib/siteSummary.js` and pinned by
`src/pages/admin/siteSummary.parity.test.js`, which computes every number both
ways over one fixture. A module switched off in `moduleEntitlements` drops its
line. WhatsApp's 4,096-character body limit is enforced by adding contacts until
the budget runs out and ending with "+N more in the app".

An ambiguous name gets an interactive list (≤10 rows) of matching sites; more
than ten asks for the code.

## Flow

```
Meta ──POST (X-Hub-Signature-256)──► waWebhook
   1 HMAC-SHA256 of the raw body with the App Secret, constant-time compare
   2 waInbound/{sha256(wamid)} create-if-absent  (Meta retries ≠ second reply)
   3 LINK <code>  → waLinkCodes → waLinks/{waId}
   4 waLinks/{waId} → users/{uid}, re-read live: approved, same org, own password
   5 UNLINK / STOP honoured before the rate limit
   6 30/hour, 150/day per number (IST windows); one notice, then silence
   7 resolve code → name → contains → fuzzy, ONLY among sites the user reaches
   8 waSiteSnapshots/{orgId} (one read) + erpContacts → one reply via Graph API
   9 waQueryLog row (no message text)
```

**Searching only within reach** is the privacy property. A site outside the
user's grants is not searched at all, so "not yours" and "does not exist" are
the same reply and the bot cannot be used to enumerate the site master.
Unknown or inactive senders get one polite reply per 24 hours and nothing else.

Counts come from a snapshot rebuilt every 30 minutes (`buildWhatsAppSnapshots`,
only for orgs with a linked number) and on demand when it is older than an hour.

## Linking

Security → WhatsApp site lookup → **Link WhatsApp** calls `startWhatsAppLink`,
which issues a six-digit, single-use code valid for ten minutes (stored as a
digest). The user sends `LINK 123456` from their phone. The server now knows
both the signed-in uid that asked and the number Meta says sent it — proof of
possession. There is no admin form for typing numbers in. Five wrong codes from
one number in a day block linking from it for 24 hours. One number per person;
a new link replaces the old one.

## Configuration

Off by default. It answers only when **all** of these are real:

| Name | Kind | Value |
|---|---|---|
| `WA_APP_SECRET` | Secret Manager | Meta app's App Secret (verifies webhook signatures) |
| `WA_ACCESS_TOKEN` | Secret Manager | System User token with `whatsapp_business_messaging` |
| `WA_VERIFY_TOKEN` | Secret Manager | Random string, also typed into Meta's webhook "Verify token" |
| `WA_PHONE_NUMBER_ID` | param | Cloud API phone number id |
| `WA_ENABLED` | param | `true` to switch on — the kill switch |
| `WA_GRAPH_VERSION` | param | default `v25.0` |
| `WA_DISPLAY_NUMBER` | param | the number shown on the Security page |
| `WA_DAILY_CAP` | param | global outbound replies per day, default 2000 |

The deploy step creates the three secrets as `UNSET-PLACEHOLDER` when missing so
the functions deploy; a placeholder never authenticates anything. Subscribe the
app to the WABA's `messages` field.

## Data protection

See `docs/DATA-RIGHTS.md` ("WhatsApp site lookup"). In short: `waLinks` and
`waQueryLog` are in the subject-access inventory, everything `wa*` is
server-only in the rules (tested in `tests/whatsapp.rules.test.js`), phone
numbers appear outside `waLinks` only as a keyed digest, message text is never
stored, and the profile name in the webhook payload is dropped.
