// ─────────────────────────────────────────────────────────────────────────────
// Third-party connection settings, one document per integration.
//
// /organizations/{orgId}/integrations/{name}, admin-only on both sides — see the
// match block in firestore.rules and tests/integrations.rules.test.js. The
// collection is excluded from the generic member grant, which is the half that
// does the work: a narrow rule restricts nothing while a broader one still
// grants the same access.
//
// There is deliberately no subscribe() here, and no read helper either. The
// settings screen reads the connection back through the `metabaseConfig`
// callable, which strips the credential before it answers; a live client
// subscription would hand the browser the API key on every snapshot, which is
// exactly what the server-side design exists to avoid.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { logAudit } from './orgData'
import { AUDIT } from '../audit/audit'

export const integrationRef = (orgId, name) =>
  doc(db, 'organizations', orgId, 'integrations', name)

/**
 * Say, on the ORG document, whether an integration is connected.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 *
 * The settings above are admin-only by design, and correctly so — they hold a
 * credential. But that means an ordinary member cannot tell whether their
 * organization has an integration at all, and the consequence was visible in
 * the product: every tenant on the platform got an ODIN tab, most of them had
 * no warehouse to point it at, and the tab's whole content was an invitation to
 * connect something they had never heard of. A feature built for one customer
 * was a chore for all the others.
 *
 * So a BOOLEAN — and nothing else — is mirrored onto the org document, which
 * every approved member already reads for branding and scope. No URL, no key,
 * no question ids: just whether the tab has anything to show. It is derived
 * from the saved connection rather than typed, so it cannot drift from it.
 *
 * Failure is swallowed. This governs whether a tab is offered; a connection
 * that saved correctly must not report itself as failed because the signpost
 * for it did not.
 */
export async function setIntegrationConnected(orgId, name, connected) {
  try {
    await setDoc(
      doc(db, 'organizations', orgId),
      { integrations: { [name]: Boolean(connected) } },
      { merge: true },
    )
  } catch {
    /* the connection itself is saved; the tab appearing can wait for the next save */
  }
}

/**
 * Save (or update) an integration's settings.
 *
 * Merged, not replaced, so an admin who changes only the question IDs does not
 * have to re-type the API key — and so a caller can never accidentally clear a
 * credential by omitting it. Clearing is explicit: pass `apiKey: ''`.
 *
 * The audit entry names the FIELDS that changed and never their values. A
 * credential written into the append-only trail is a credential that outlives
 * every rotation of it.
 */
export async function saveIntegration(orgId, name, settings, actor) {
  await setDoc(integrationRef(orgId, name), { ...settings, updatedAt: serverTimestamp() }, { merge: true })
  await logAudit(orgId, actor, AUDIT.ORG_SETTINGS, {
    target: 'integration',
    targetId: name,
    targetLabel: name,
    summary: `Updated ${name} integration settings: ${Object.keys(settings).join(', ')}`,
  })
}
