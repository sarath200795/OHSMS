// ─────────────────────────────────────────────────────────────────────────────
// Stamping orgId onto QR mirror documents that predate the field.
//
// /qr/{token} is the public, unauthenticated copy of an asset that a scanned
// label resolves to. Its update rule reads resource.data.orgId DIRECTLY:
//
//   allow update: if resource != null
//     && isWriterOf(resource.data.orgId)
//     && request.resource.data.orgId == resource.data.orgId;
//
// Reading a field that is not there RAISES in Firestore rules, and a raising
// rule DENIES. So any mirror written before orgId joined the payload cannot be
// updated by anyone — and because the bulk extinguisher import writes each
// asset and its mirror in one batch, a SINGLE such document fails the entire
// upload. Reproduced against the emulator: 771 rows, one legacy mirror, every
// row refused with permission-denied.
//
// The rule is right and is deliberately not being loosened. Accepting an absent
// orgId would let anyone who scans a label claim that mirror into their own
// organization and control what the label then shows — a defacement route onto
// a safety notice. The DATA is what is stale, so the data is what gets fixed.
//
// Pure, so the decisions are testable without the Admin SDK. Extinguishers,
// AEDs and FAS devices all share this one collection.
// ─────────────────────────────────────────────────────────────────────────────

/** Collections whose documents carry a qrToken pointing into /qr. */
export const QR_SOURCES = ['extinguishers', 'aeds', 'fas', 'signages']

/**
 * Decide what to stamp.
 *
 * @param assets  [{ collection, id, qrToken }] every asset in ONE org
 * @param mirrors Map<token, data|null> the /qr document for each token, or null
 * @param orgId   the org those assets belong to
 *
 * Never touches a mirror that already names an org — not even to "correct" one
 * naming a different org. A mirror carrying another tenant's id is either a
 * token collision or something worse, and quietly rewriting it would hand this
 * org an asset that answers to somebody else's label. Those are reported for a
 * human instead.
 */
export function planQrBackfill(assets, mirrors, orgId) {
  const writes = []
  const foreign = []
  const missingMirror = []
  let alreadyStamped = 0
  const seen = new Set()

  for (const a of assets) {
    const token = String(a?.qrToken || '').trim()
    if (!token) continue

    // Two assets naming one token is its own defect, but it must not produce
    // two conflicting writes in the same batch.
    if (seen.has(token)) continue
    seen.add(token)

    const mirror = mirrors.get(token)
    if (mirror == null) {
      // The asset points at a mirror that is not there. Creating it is a
      // different operation with a different payload, so it is reported rather
      // than guessed at.
      missingMirror.push({ collection: a.collection, id: a.id, token })
      continue
    }

    const existing = mirror.orgId
    if (existing === orgId) { alreadyStamped += 1; continue }
    if (existing != null && existing !== '') {
      foreign.push({ token, collection: a.collection, id: a.id, orgId: existing })
      continue
    }

    writes.push({ token, patch: { orgId }, collection: a.collection, id: a.id })
  }

  return { writes, alreadyStamped, missingMirror, foreign }
}
