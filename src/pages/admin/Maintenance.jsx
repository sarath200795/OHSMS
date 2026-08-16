import { useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, FileStack, Play, Check, Bug, Unlock, QrCode, HeartPulse, Stethoscope, FileLock2, MapPin, Lock, UserSearch, Download } from 'lucide-react'
import { Card, Button } from '../../shared/ui'
import { backfillDocumentVisibility, backfillClaims, clearOrphanedDefectLocks, backfillQrMirrors, seedInjuryRecords, stripIncidentMedicalDetail, confineMedicalRecords, linkEquipmentSites, sealStoredObjects, exportSubjectData } from '../../shared/functions'
import { reportError } from '../../shared/monitoring'
import { useAuth } from '../../shared/auth/AuthContext'
import { backfillProcedureMirrors } from '../../modules/loto/services/procedures'
import { backfillAll } from '../../shared/crypto/backfill'
import { sealingEnabled } from '../../shared/crypto/keyring'

/**
 * One-off migrations, run by an admin for their own organization.
 *
 * These exist as buttons because the alternative was a production password in
 * someone's shell, or a console incantation that cannot work: the app is a
 * bundled build, so a bare `import('firebase/functions')` does not resolve at a
 * DevTools prompt, and nothing is exposed on window.
 *
 * Both are idempotent and both are per-organization — the function reads the
 * org off the caller, so an admin of each tenant runs it once for theirs.
 */
export default function Maintenance() {
  return (
    <div className="space-y-4">
      <DocumentVisibility />
      <QrMirrors />
      <EquipmentSites />
      <MedicalDetail />
      <MedicalRecordFiles />
      <SealHistory />
      <SealStoredFiles />
      <OrgClaims />
      <ProcedureMirrors />
      <DefectLocks />
      <SubjectAccess />
      <ErrorReporting />
    </div>
  )
}

/**
 * A subject access request — everything the organization holds about one person.
 *
 * This stores injuries, illnesses and medical records, which under GDPR and
 * India's DPDP Act is sensitive personal data a person may ask to see. Until
 * now the only answer was somebody opening screens one at a time and hoping
 * they had thought of all of them.
 *
 * Two things this screen is careful about, both of which are the difference
 * between a real answer and a plausible one:
 *
 * It shows the MENTIONS list even though it is empty of results. A name is also
 * free text inside array objects — who attended a committee meeting, who was
 * affected by an incident — and Firestore cannot query inside those. Showing
 * only the queryable half would present an incomplete export as a finished one.
 *
 * And it shows what CANNOT be erased, next to what can. In an occupational
 * health system the honest response to "delete everything about me" is mostly
 * a refusal with reasons: the injury record is the worker's own evidence of
 * what happened to them, and the law requires it be kept.
 */
function SubjectAccess() {
  const { orgId } = useAuth()
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    const subject = uid.trim()
    if (!subject) return toast.error('Enter the person’s user id.')
    setBusy(true)
    try {
      const r = await exportSubjectData({ uid: subject, encryptionOn: sealingEnabled })
      setResult(r)
      const found = Object.values(r.records || {}).reduce((n, rows) => n + rows.length, 0)
      toast.success(`${found} record${found === 1 ? '' : 's'} found by key`)
    } catch (err) {
      reportError(err, { where: 'exportSubjectData' })
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    // A subject access response is a document that gets sent to a person, so it
    // has to leave the browser as a file rather than as something to screenshot.
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subject-access-${uid.trim() || 'export'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const counts = result && Object.entries(result.records || {})
    .map(([path, rows]) => `  · ${path}: ${rows.length}`)
    .join('\n')

  return (
    <Job
      icon={UserSearch}
      title="Subject access request"
      result={result && [
        `Found by key — complete:\n${counts || '  (nothing)'}`,
        `\nNeeds a human to review — cannot be queried:`,
        ...(result.mentions || []).map((m) => `  · ${m.path}: ${m.fields.join(', ')}`),
        result.scan?.feasible === false ? `\n⚠ ${result.scan.note}` : '',
        `\nErasure: ${result.erasure?.refused?.length || 0} source(s) must be RETAINED by law, ` +
        `${result.erasure?.anonymise?.length || 0} anonymised, ${result.erasure?.erasable?.length || 0} erasable.`,
        ...(result.erasure?.refused || []).map((r) => `  · ${r.path} — ${r.why}`),
        result.problems?.length ? `\n⚠ ${result.problems.length} source(s) failed to read` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <input
            aria-label="User id of the person"
            className="min-w-[18rem] flex-1 rounded-xl border border-ink-200 px-3 py-1.5 text-xs"
            placeholder="User id (uid) of the person"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
          />
          <Button icon={Play} loading={busy} disabled={busy || !orgId} onClick={run}>
            Gather
          </Button>
          {result && (
            <Button variant="ghost" icon={Download} onClick={download}>
              Download JSON
            </Button>
          )}
        </>
      }
    >
      <p>
        Gathers everything held about one member of this organization, for a subject
        access request. Managers and admins only, and only for people in your own
        organization.
      </p>
      <p>
        <strong>The two halves mean different things.</strong> What is found by key is
        complete. What is listed underneath cannot be searched at all — a person’s name
        also sits as free text inside lists like who attended a meeting or who was
        affected by an incident, and those need a person to read them.
      </p>
      <p>
        Erasure is shown but not offered. Most of an occupational-health record cannot
        lawfully be deleted on request, and the reasons listed are the ones to send back
        to the person asking.
      </p>
    </Job>
  )
}

/**
 * Publish the isolation procedures that predate the public QR view.
 *
 * The QR printed on a LOTO procedure now opens a read-only view for whoever is
 * standing at the machine, with no account. That view reads a mirror document
 * holding the instructions and the live lock state, and deliberately not the
 * names of the people who applied the locks.
 *
 * Every writer keeps the mirror current, and each rebuilds it in full, so any
 * procedure that gets locked, approved or revised publishes itself. The gap is
 * the procedure nobody touches — an approved isolation on a machine that is
 * simply running. Its code would answer "does not match a current procedure",
 * which on a LOTO tag is an alarming way to say "nothing has changed".
 *
 * Unlike its neighbours this runs in the browser rather than as a callable: the
 * writes are the same ones the app already makes, under the same rules, so it
 * needs no privilege an admin does not already have.
 */
function ProcedureMirrors() {
  const { orgId } = useAuth()
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    if (!orgId) return toast.error('No organization on your profile.')
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await backfillProcedureMirrors(orgId, { dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Published ${r.written} procedure${r.written === 1 ? '' : 's'}`)
      } else if (r.missing === 0) {
        toast.success('Nothing to do — every procedure is already published')
      }
    } catch (err) {
      reportError(err, { where: 'backfillProcedureMirrors' })
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.missing === 0

  return (
    <Job
      icon={QrCode}
      title="Publish procedure QR pages"
      result={preview && [
        `${preview.total} procedure${preview.total === 1 ? '' : 's'} in this organization`,
        `${preview.present} already published`,
        `${preview.missing} whose printed code leads nowhere`,
        preview.ids?.length ? `\n${preview.ids.map((i) => `  · ${i}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Published' : 'Publish them'}
          </Button>
        </>
      }
    >
      <p>
        Scanning the QR on an isolation procedure opens a read-only view — the isolation
        points, the hazards, how to verify each one dead, and which points are locked right
        now — without needing an account. Locking a point still requires signing in.
      </p>
      <p>
        Procedures written before this existed have no published view until something
        changes them. This publishes the rest. It copies no names: the page shows that a
        point is locked, never who locked it.
      </p>
    </Job>
  )
}

/**
 * Release defect locks that outlived the fault they described.
 *
 * A QR defect report writes a lock so five people scanning the same discharged
 * extinguisher file one report, not five. Resolving the defect from the Action
 * Tracker used to remove it from the unit WITHOUT releasing the lock, and the
 * locks that left behind cannot be reached from anywhere else in the app — the
 * defect is gone, so there is nothing left to resolve. The symptom is a scanner
 * being told a fault "has already been reported", permanently.
 */
function DefectLocks() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await clearOrphanedDefectLocks({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Released ${r.removed} lock${r.removed === 1 ? '' : 's'}`)
      } else if (r.wouldRemove === 0) {
        toast.success('Nothing stuck — every lock still describes a live fault')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.wouldRemove === 0

  return (
    <Job
      icon={Unlock}
      title="Release stuck defect reports"
      result={preview && [
        `${preview.total} lock${preview.total === 1 ? '' : 's'} on record`,
        `${preview.kept} still describe a live fault and are kept`,
        `${preview.wouldRemove} stuck`,
        preview.ids?.length ? `\n${preview.ids.map((i) => `  · ${i}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Released' : 'Release them'}
          </Button>
        </>
      }
    >
      <p>
        When someone scans a QR code to report a fault, that fault is locked so the next
        five people scanning the same unit do not file the same report again. The lock is
        meant to last exactly as long as the fault.
      </p>
      <p>
        If a lock outlives its fault, that unit can never be reported for it again — the
        scanner is told it has already been reported. This finds locks whose fault is no
        longer open anywhere and releases them. A fault still awaiting approval, or still
        open on the unit, is left alone.
      </p>
    </Job>
  )
}

/**
 * Prove error reporting reaches Sentry, from the deployed build.
 *
 * The existing `?__crash=1` hook is gated on import.meta.env.DEV, so it cannot
 * answer the only question that matters — whether errors arrive from
 * PRODUCTION. Without this, configuring the DSN is an act of faith until the
 * first real crash, which is the worst moment to discover a typo in it.
 */
function ErrorReporting() {
  const [sent, setSent] = useState(false)
  const configured = Boolean((import.meta.env.VITE_SENTRY_DSN || '').trim())

  const send = () => {
    // A real Error, through the real funnel — not a synthetic call that would
    // prove a different path works.
    reportError(new Error('Test event from Maintenance — error reporting is wired up'), {
      deliberate: true,
      sentAt: new Date().toISOString(),
    })
    setSent(true)
  }

  return (
    <Job
      icon={Bug}
      title="Check error reporting"
      result={sent && (configured
        ? 'Sent. It should appear in Sentry within a minute — look for "Test event from Maintenance".'
        : 'Logged to this browser console only. No DSN is configured in this build.')}
      actions={
        <Button variant="ghost" icon={sent ? Check : Bug} onClick={send}>
          {sent ? 'Send another' : 'Send a test event'}
        </Button>
      }
    >
      <p>
        {configured
          ? 'Error reporting is configured in this build. Send a test event to confirm it arrives.'
          : 'No error reporting is configured in this build, so crashes are only written to the browser console — nobody finds out unless a user tells you. Set VITE_SENTRY_DSN and redeploy.'}
      </p>
      <p>
        This sends one deliberate error through the same path a real crash takes,
        so it proves the whole funnel rather than just the connection.
      </p>
    </Job>
  )
}

/**
 * Encrypt what was stored before encryption was switched on.
 *
 * Turning it on seals new writes and nothing else, so every record filed before
 * that moment is still in plaintext in the database — and what is already stored
 * IS the exposure. Same reasoning as the three jobs above it, which is why it
 * sits with them.
 *
 * Unlike those, this one runs IN THE BROWSER rather than as a Cloud Function.
 * The reason is in the header of src/shared/crypto/backfill.js and is worth
 * repeating here because it explains the slow progress bar: the field path is
 * bound into every sealed value, so a server-side copy of the policy that
 * drifted by one character would seal records nothing could ever open again.
 * Running it here means there is one implementation and it cannot disagree with
 * itself.
 */
function SealHistory() {
  const { orgId } = useAuth()
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [at, setAt] = useState('')
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    setAt('')
    try {
      const r = await backfillAll(orgId, { dryRun, onProgress: setAt })
      setPreview(r)
      if (!dryRun) {
        // `remaining` is not a failure — a run is capped so it can finish. Say
        // so, or the second run looks like the first one not having worked.
        setDone(r.remainingTotal === 0 && r.blockedTotal === 0)
        toast.success(`Encrypted ${r.sealedTotal} record${r.sealedTotal === 1 ? '' : 's'}`)
      } else if (r.sealedTotal === 0) {
        toast.success('Nothing to encrypt — every record is already sealed')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
      reportError(err, { source: 'maintenance.sealHistory' })
    } finally {
      setBusy('')
      setAt('')
    }
  }

  const nothingToDo = preview && preview.sealedTotal === 0 && preview.remainingTotal === 0
  const blocked = preview?.blockedTotal || 0

  return (
    <Job
      icon={Lock}
      title="Encrypt existing records"
      result={preview && [
        `${preview.scannedTotal} record${preview.scannedTotal === 1 ? '' : 's'} checked`,
        `${preview.sealedTotal} ${preview.dryRun ? 'to encrypt' : 'encrypted'}, ${preview.alreadySealedTotal} already encrypted`,
        '',
        ...preview.results
          .filter((r) => r.scanned || r.sealed)
          .map((r) => `  · ${r.collection}: ${r.sealed} of ${r.scanned}`),
        preview.remainingTotal
          ? `\n  · ${preview.remainingTotal} more than one run may do — run it again to finish`
          : '',
        // Never the field values and never a filename: a report that named what
        // it could not seal would be one more copy of the thing being confined.
        // The collection and the document id find any row and carry nothing
        // clinical — the same rule planMedicalStrip follows.
        blocked ? `\n  ⚠ ${blocked} could not be encrypted and ${blocked === 1 ? 'was' : 'were'} left exactly as ${blocked === 1 ? 'it is' : 'they are'}:` : '',
        ...(blocked ? preview.blocked.slice(0, 20).map((b) => `      ${b.collection} · ${b.id} · ${b.reason}`) : []),
        blocked > 20 ? `      …and ${blocked - 20} more` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Encrypted' : 'Encrypt them'}
          </Button>
          {busy && at && <span className="self-center text-xs text-ink-500">Reading {at}…</span>}
        </>
      }
    >
      <p>
        Incident narratives, injury and illness records, meeting minutes and drill debriefs
        are encrypted in the browser before they are saved. That applies to records saved
        from now on. Everything filed before it was switched on is still stored in readable
        form, and that is where the risk actually sits — closing the door does nothing about
        what is already through it.
      </p>
      <p>
        Nothing is replaced until it has been decrypted again and checked against the original,
        field by field. A record that fails that check is left exactly as it was and listed
        below, so an interrupted or imperfect run can never leave you with a record nobody
        can read. Running it twice is safe: anything already encrypted is skipped.
      </p>
      <p>
        This runs in this browser tab rather than on the server, so leave the page open until
        it finishes. Large organizations take several runs — the count of what is left is
        reported each time.
      </p>
    </Job>
  )
}

/**
 * Encrypt the files already in the bucket.
 *
 * The card above re-writes DOCUMENTS. This one re-writes BYTES, and they are
 * genuinely separate jobs: the field backfill runs in this tab, and a tenant's
 * objects run to gigabytes, so this is the one part of the encryption work that
 * had to be a Cloud Function.
 *
 * Run the document card first. Not a hard dependency — they touch different
 * things — but a run that seals the pointers and not the files leaves the
 * confusing state where a filename is encrypted and the photograph it names is
 * not, and the order below is the one an operator can reason about.
 */
function SealStoredFiles() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await sealStoredObjects({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(r.remaining === 0 && r.failedTotal === 0 && r.blockedTotal === 0)
        toast.success(`Encrypted ${r.sealedTotal} file${r.sealedTotal === 1 ? '' : 's'}`)
      } else if (r.sealedTotal === 0) {
        toast.success('Nothing to encrypt — every stored file is already sealed')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
      reportError(err, { source: 'maintenance.sealStoredFiles' })
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.sealedTotal === 0 && preview.remaining === 0
  const blocked = preview?.blockedTotal || 0
  const failed = preview?.failedTotal || 0

  return (
    <Job
      icon={FileLock2}
      title="Encrypt existing files"
      result={preview && [
        `${preview.scannedTotal} stored file${preview.scannedTotal === 1 ? '' : 's'} checked`,
        `${preview.sealedTotal} ${preview.dryRun ? 'to encrypt' : 'encrypted'}, ${preview.alreadySealedTotal} already encrypted`,
        '',
        ...preview.results
          .filter((r) => r.scanned || r.sealed)
          .map((r) => `  · ${r.collection}: ${r.sealed} of ${r.scanned}`),
        preview.remaining ? `\n  · ${preview.remaining} more than one run may do — run it again to finish` : '',
        // Never a filename, here or in the function's response. A migration
        // report that named the files it handled would be one more copy of the
        // thing being confined.
        blocked ? `\n  ⚠ ${blocked} name a file outside this organization and ${blocked === 1 ? 'was' : 'were'} not touched:` : '',
        ...(blocked ? preview.blocked.slice(0, 20).map((b) => `      ${b.collection} · ${b.id} · ${b.reason}`) : []),
        failed ? `\n  ⚠ ${failed} could not be encrypted. The original is still readable — nothing was lost:` : '',
        ...(failed ? preview.failed.slice(0, 20).map((b) => `      ${b.collection} · ${b.id} · ${b.reason}`) : []),
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Encrypted' : 'Encrypt them'}
          </Button>
        </>
      }
    >
      <p>
        Photographs, drill evidence and attachments uploaded from now on are encrypted before
        they leave the browser. Everything uploaded before that is still stored readable by
        anything that reaches the file storage rather than the app — a backup, a
        misconfiguration, an account with read access to the project.
      </p>
      <p>
        Each file is written to a new encrypted copy, downloaded back and decrypted to prove it
        is intact, and only then is the readable original deleted. If anything fails at any
        point the original is left exactly where it is, so an interrupted run never loses a
        file. Running it twice is safe.
      </p>
      <p>
        Run the record encryption above first. This one is capped per run because each file is
        downloaded and re-uploaded — large sites will need several, and the count of what is
        left is reported each time.
      </p>
    </Job>
  )
}

/** Shared shell: title, why it matters, a result panel, and the action. */
function Job({ icon: Icon, title, children, result, actions }) {
  return (
    // Labelled as a region so each job is its own landmark: several of these
    // carry a button called "Check first", and without this neither a screen
    // reader nor a test can tell which one it is looking at.
    <Card role="region" aria-label={title}>
      <div className="mb-1 flex items-center gap-2">
        <Icon size={16} className="shrink-0 text-ink-500" />
        <h2 className="text-sm font-bold text-ink-800">{title}</h2>
      </div>
      <div className="max-w-[62ch] space-y-2 text-xs leading-relaxed text-ink-500">{children}</div>
      {result && (
        <pre className="mt-3 overflow-x-auto rounded-xl bg-ink-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-700">
          {result}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </Card>
  )
}

/**
 * Why a row could not be handled, said the way an admin can act on.
 *
 * The reason codes are the whole point of the report and none of them used to
 * reach the screen: this card printed `blockedFields.join(', ')`, and
 * blockedFields is a COUNT, so the line silently rendered nothing and `reason`
 * was never shown at all. A run that reported one blocked row looked, on screen,
 * like a run that had simply found nothing to do.
 */
const BLOCK_REASONS = {
  'no-injury-record': 'no injury record exists yet — run step 1',
  'missing-in-injury': 'the injury record does not hold this detail yet — run step 1',
  'no-person-id': 'the row names no person, so there is no injury record to write to',
  'sign-in-id-only': 'the person is identified only by sign-in id — set the person on the incident first',
  'injury-record-verified': 'the injury record is verified and locked',
  'injury-record-deleted': 'the injury record is in the Recycle Bin',
  'differs-in-injury': 'the injury record says something different — only a person can say which is right',
  // Step 3's reasons. It files each document under the injured person it belongs
  // to, and the old shape never recorded whose it was.
  'several-people': 'more than one person was injured, and nothing says whose document this is',
  'foreign-path': 'the file is stored outside this organization — it will not be touched',
}

/** Blocked rows collapsed to "n × plain english", newest concern first. */
const blockedLines = (rows = []) => {
  const counts = new Map()
  for (const r of rows) counts.set(r.reason, (counts.get(r.reason) || 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `  · ${n} × ${BLOCK_REASONS[reason] || reason}`)
}

/**
 * The medical-detail migration, in the order it has to run.
 *
 * Two steps, two callables, two buttons, deliberately. Step 2 refuses to take a
 * field off an incident unless it can first find that field in the matching
 * injury record — because /injuries is the only copy left afterwards, and an
 * unproved removal destroys a medical record instead of confining it. On real
 * data that guard fired with an injury record already present (1 incident,
 * 1 injury record, 0 to write, 1 blocked): the record existed and was not
 * COMPLETE, and nothing in the app fills that gap.
 *
 * So step 1 writes the missing detail into the injury record, and step 2 is
 * held shut until step 1 reports nothing left to write. Both share one state
 * here so the gate cannot be got around by scrolling.
 */
function MedicalDetail() {
  const [busy, setBusy] = useState('')
  const [seed, setSeed] = useState(null)
  const [seeded, setSeeded] = useState(false)
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const runSeed = async (dryRun) => {
    setBusy(dryRun ? 'seed-dry' : 'seed-write')
    try {
      const r = await seedInjuryRecords({ dryRun })
      setSeed(r)
      // A strip preview taken before this seed described a world that no longer
      // exists. Clearing it forces step 2 to be checked again rather than
      // committing on the strength of a stale count.
      setPreview(null)
      if (!dryRun) {
        setSeeded(true)
        toast.success(`Filled in ${r.written} injury record${r.written === 1 ? '' : 's'}`)
      } else if (r.wouldWrite === 0) {
        toast.success('Nothing to fill in — every injury record already holds its detail')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const runStrip = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await stripIncidentMedicalDetail({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Cleaned ${r.written} incident${r.written === 1 ? '' : 's'}`)
      } else if (r.wouldWrite === 0) {
        toast.success('Nothing to do — no incident still carries medical detail')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  // Step 2 stays shut until step 1 has been RUN and reports nothing outstanding.
  // Not merely until it reports zero: never having looked and having looked and
  // found nothing are different states, and only one of them is evidence.
  const needsSeeding = !seed || seed.wouldWrite > 0
  const nothingToDo = preview && preview.wouldWrite === 0
  // Rows step 2 will NOT touch, because the detail is not in the injury record.
  // Writing past these would delete an injury record rather than move it.
  const blocked = preview?.blockedTotal || 0

  return (
    <>
      <Job
        icon={Stethoscope}
        title="Step 1 — Fill in the injury records"
        result={seed && [
          `${seed.incidents} incident${seed.incidents === 1 ? '' : 's'}, ${seed.injuries} injury record${seed.injuries === 1 ? '' : 's'}`,
          `${seed.wouldWrite} injury record${seed.wouldWrite === 1 ? '' : 's'} to write — ${seed.created} to create, ${seed.completed} to complete`,
          `${seed.seeded} field${seed.seeded === 1 ? '' : 's'} of detail would be copied in; ${seed.alreadyHeld} already there`,
          seed.blockedTotal ? `\n  ⚠ ${seed.blockedTotal} ${seed.blockedTotal === 1 ? 'row needs' : 'rows need'} a person, not a migration:` : '',
          ...(seed.blockedTotal ? blockedLines(seed.blocked) : []),
          seed.orphanInjuryTotal
            ? `\n  · ${seed.orphanInjuryTotal} ${seed.orphanInjuryTotal === 1 ? 'injury record belongs' : 'injury records belong'} to nobody named on their incident — left alone`
            : '',
        ].filter(Boolean).join('\n')}
        actions={
          <>
            <Button variant="ghost" icon={Play} loading={busy === 'seed-dry'} disabled={Boolean(busy)} onClick={() => runSeed(true)}>
              Check first
            </Button>
            <Button
              icon={seeded ? Check : undefined}
              loading={busy === 'seed-write'}
              disabled={Boolean(busy) || !seed || seed.wouldWrite === 0}
              onClick={() => runSeed(false)}
            >
              {seeded ? 'Filled in' : 'Fill them in'}
            </Button>
          </>
        }
      >
        <p>
          This writes injury detail — body parts, injury type, medication, first-aid notes,
          days lost — <strong>into</strong> the injury record, which only managers can read.
          It changes nothing else: it does not touch the incident, and step 2 below is what
          removes the copy that everyone can see.
        </p>
        <p>
          Only gaps are filled. Where the injury record already has an answer it is left
          exactly as it is, even if the incident says something different — that
          disagreement is reported for a person to settle. A verified record, one in the
          Recycle Bin, and a row that names no person are all reported and never written to.
        </p>
        <p>
          Records written here are marked pending, because a migration copied them and
          nobody has reviewed them. Read them on the Injuries page before running step 2.
        </p>
      </Job>

      <Job
        icon={HeartPulse}
        title="Step 2 — Clean medical detail off incidents"
        result={[
          needsSeeding && (seed
            ? `Step 1 still has ${seed.wouldWrite} injury record${seed.wouldWrite === 1 ? '' : 's'} to write. Finish it first — anything cleaned before then would be deleted, not moved.`
            : 'Run step 1 first. Until it reports nothing left to write, there is no way to tell whether cleaning an incident moves the detail or destroys it.'),
          preview && [
            `${preview.incidents} incident${preview.incidents === 1 ? '' : 's'} in this organization`,
            `${preview.wouldWrite} still carrying medical detail`,
            `${preview.confined} field${preview.confined === 1 ? '' : 's'} proved to be in the injury record already, ${preview.emptied} blank`,
            blocked ? `\n  ⚠ ${blocked} cannot be cleaned — the detail is not in the injury record, so removing it would lose it:` : '',
            ...(blocked ? blockedLines(preview.blocked) : []),
          ].filter(Boolean).join('\n'),
        ].filter(Boolean).join('\n\n') || null}
        actions={
          <>
            <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy) || needsSeeding} onClick={() => runStrip(true)}>
              Check first
            </Button>
            <Button
              icon={done ? Check : undefined}
              loading={busy === 'write'}
              // Same gate as its neighbours — you must look before you write —
              // plus the sequencing one: step 1 has to be finished, or this
              // removes the only copy of somebody's injury.
              disabled={Boolean(busy) || needsSeeding || !preview || nothingToDo}
              onClick={() => runStrip(false)}
            >
              {done ? 'Cleaned' : 'Clean them'}
            </Button>
          </>
        }
      >
        <p>
          Injury detail used to be saved twice: once to the injury record, which only
          managers can read, and once onto the incident, which every member and any
          external auditor can list. New incidents no longer do this. Existing ones still
          hold the second copy.
        </p>
        <p>
          This removes that second copy, keeping only the person and name needed to link
          the two. Nothing is removed until it has been found in the injury record, field
          by field — a row that fails that check is skipped and reported, never deleted.
        </p>
      </Job>
    </>
  )
}

/**
 * Step 3 — the attached DOCUMENTS, which steps 1 and 2 do not touch.
 *
 * Steps 1 and 2 move the injury FIELDS. The files attached to them — a GP
 * letter, a fit note, a discharge summary — were filed as incident photos, in a
 * subcollection every member and the external auditor can list, so one query
 * returned the filename, caption and download link of every medical document in
 * the organization. The document IS the record; confining the fields and leaving
 * the scan behind closed half of it.
 *
 * A separate card rather than a third button inside MedicalDetail: this moves
 * files rather than fields, it can run before or after step 2 without changing
 * what either does, and it has one consequence of its own — an old download link
 * stops working — that has to be read before it is triggered rather than
 * scrolled past on the way to a familiar button.
 *
 * Blocked rows do NOT gate the write, unlike the equipment card. There the rows
 * that need a human are the reason to stop and look; here every record left
 * behind stays listable by the whole organization, so refusing to move forty
 * records because the forty-first cannot be attributed keeps forty medical
 * documents exposed to protect nothing. They are reported, and they are never
 * touched.
 */
function MedicalRecordFiles() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await confineMedicalRecords({ dryRun })
      setPreview(r)
      if (!dryRun) {
        // `remaining` is not a failure — a run is capped so it can finish. Say
        // so, or the second run looks like the first one not having worked.
        setDone(r.remaining === 0)
        toast.success(`Moved ${r.moved} record${r.moved === 1 ? '' : 's'}`)
      } else if (r.wouldMove === 0) {
        toast.success('Nothing to move — no medical record is filed with the incident photos')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.wouldMove === 0
  const blocked = preview?.blockedTotal || 0
  const failed = preview?.failedTotal || 0

  return (
    <Job
      icon={FileLock2}
      title="Step 3 — Move the medical record files"
      result={preview && [
        `${preview.records} medical record${preview.records === 1 ? '' : 's'} filed with the incident photos, out of ${preview.photos} attachment${preview.photos === 1 ? '' : 's'}`,
        `${preview.wouldMove} to move${preview.moved ? `, ${preview.moved} moved` : ''}`,
        `${preview.filesToMove} file${preview.filesToMove === 1 ? '' : 's'} still stored where everyone in this organization can read ${preview.filesToMove === 1 ? 'it' : 'them'}`,
        preview.urlsDropped
          ? `${preview.urlsDropped} carr${preview.urlsDropped === 1 ? 'ies' : 'y'} a permanent download link — see below for what that does and does not fix`
          : '',
        preview.inlineRecords ? `  · ${preview.inlineRecords} held inside the record itself, with no separate file` : '',
        preview.underDeletedInjury ? `  · ${preview.underDeletedInjury} belong to an injury record in the Recycle Bin — moved anyway` : '',
        preview.remaining ? `\n  · ${preview.remaining} more than one run may move — run it again to finish` : '',
        blocked ? `\n  ⚠ ${blocked} cannot be moved without guessing whose ${blocked === 1 ? 'it is' : 'they are'}:` : '',
        ...(blocked ? blockedLines(preview.blocked) : []),
        failed ? `\n  ⚠ ${failed} could not be moved and ${failed === 1 ? 'was' : 'were'} left exactly where ${failed === 1 ? 'it was' : 'they were'}` : '',
        preview.tokensLeft ? `  · ${preview.tokensLeft} moved but kept an unused download token` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Moved' : 'Move them'}
          </Button>
        </>
      }
    >
      <p>
        Documents attached to an injury — a GP letter, a fit note, a discharge summary —
        were saved alongside the incident photos, where every member and any external
        auditor can list them by name. This files each one under the injured person&apos;s
        injury record instead, and moves the file itself to storage only managers can read.
      </p>
      <p>
        Each document is moved before the old copy is removed, and only after the new one
        has been read back and checked. If a run is interrupted, a record is left in both
        places — never in neither. Run it again to finish.
      </p>
      <p>
        <strong>About the download links.</strong> Every one of these records carries a link
        that works in any browser, signed in or not, with no account and no permission
        check. Moving the file deletes it from the old location, so that link stops working
        — that, or deleting the file outright, is the only thing that revokes one. What
        nothing here can undo is a link that has already been used: a document somebody
        downloaded last March is on their computer, and no migration reaches it. If a record
        went to someone who should not have had it, that is an incident to handle, not a
        button. Records this cannot move keep their link until their file is deleted or its
        download token is rotated.
      </p>
      <p>
        A document on an incident that injured more than one person is reported, not filed:
        nothing recorded whose it was, and filing one colleague&apos;s discharge summary
        under another&apos;s name is worse than leaving it where it is for another day. Each
        document is filed under an injury record that already exists, so anything reported
        as waiting on step 1 will move once step 1 has been run.
      </p>
    </Job>
  )
}

function QrMirrors() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await backfillQrMirrors({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Stamped ${r.written} mirror${r.written === 1 ? '' : 's'}`)
      } else if (r.wouldWrite === 0) {
        toast.success('Nothing to do — every mirror already names this organization')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.wouldWrite === 0
  // A mirror naming a different organization is a token collision, and the job
  // refuses to rewrite one. Stopping here rather than writing around it: the
  // alternative is handing this tenant an asset that answers to somebody else's
  // printed label.
  const foreign = preview?.foreign?.length || 0

  return (
    <Job
      icon={QrCode}
      title="Repair QR codes"
      result={preview && [
        `${preview.assets} tagged asset${preview.assets === 1 ? '' : 's'} in this organization`,
        `${preview.alreadyStamped} already correct`,
        `${preview.wouldWrite} to repair`,
        foreign ? `\n  ⚠ ${foreign} belong to another organization and will NOT be touched` : '',
        preview.missingMirrorTotal ? `  · ${preview.missingMirrorTotal} asset(s) point at a QR record that no longer exists` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            // Same gate as the others, plus: if anything foreign turned up, that
            // needs a human before anything is written.
            disabled={Boolean(busy) || !preview || nothingToDo || foreign > 0}
            onClick={() => run(false)}
          >
            {done ? 'Repaired' : 'Repair them'}
          </Button>
        </>
      }
    >
      <p>
        Every extinguisher, AED and fire-alarm panel has a public QR record. Records
        created before those carried an organization marker cannot be updated by anyone —
        the security rule reads the marker directly, and reading a marker that is not
        there denies the write.
      </p>
      <p>
        Because a bulk upload saves each asset and its QR record together, one old record
        refuses the whole file. This repairs them. It changes nothing else, and running it
        twice does nothing the second time.
      </p>
    </Job>
  )
}

/**
 * Link equipment to the site whose name it already carries.
 *
 * The two counts this card exists to show are `ambiguous` and `conflicting`,
 * and they are the reason the write button is gated on more than "have you
 * looked". Every other job here reports things it will skip; these are things it
 * cannot tell apart. A centre name matching two sites is a coin flip, and a
 * record already linked somewhere else may have been linked by hand, correctly,
 * with the printed name being the stale half.
 *
 * The job itself never writes those rows, so the gate is not what makes the run
 * safe — it is what makes a person look. Equipment filed at the wrong site is an
 * access-control error the day equipment is scoped by site, and nobody re-reads
 * a migration that reported success.
 */
function EquipmentSites() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await linkEquipmentSites({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Linked ${r.written} record${r.written === 1 ? '' : 's'}`)
      } else if (r.wouldWrite === 0) {
        toast.success('Nothing to link — every record that can be matched already is')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.wouldWrite === 0
  const ambiguous = preview?.ambiguousTotal || 0
  const conflicting = preview?.conflictingTotal || 0
  const needsAHuman = ambiguous > 0 || conflicting > 0

  return (
    <Job
      icon={MapPin}
      title="Link equipment to its site"
      result={preview && [
        `${preview.equipment} extinguisher, AED and alarm record${preview.equipment === 1 ? '' : 's'}, against ${preview.sites} site${preview.sites === 1 ? '' : 's'}`,
        `${preview.alreadyLinked} already linked`,
        `${preview.wouldWrite} to link`,
        // Both blocks lead with the count and then name the rows, because the
        // count decides whether anything can be written and the names are what
        // somebody has to go and settle.
        ambiguous ? `\n  ⚠ ${ambiguous} whose name matches more than one site — nothing is written until these are settled` : '',
        ...(preview.ambiguous || []).map((a) => `  · ${a.centerName || '(no name)'} → ${(a.siteNames || []).join('  /  ')}`),
        conflicting ? `\n  ⚠ ${conflicting} already linked to a different site than the name says — never overwritten` : '',
        ...(preview.conflicting || []).map((c) => `  · ${c.centerName || '(no name)'} → linked to ${c.currentSiteId}, name says ${c.resolvedName}`),
        preview.unmatchedTotal
          ? `\n  ${preview.unmatchedTotal} match no site at all, under ${preview.unmatchedNameTotal} name${preview.unmatchedNameTotal === 1 ? '' : 's'}:`
          : '',
        ...(preview.unmatchedNames || []).map((n) => `  · ${n}`),
        preview.noName ? `\n  ${preview.noName} carry no centre name and cannot be matched this way` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            // Same gate as the others, plus the two that need a person. Filing a
            // fire extinguisher at the wrong site is not a cosmetic mistake.
            disabled={Boolean(busy) || !preview || nothingToDo || needsAHuman}
            onClick={() => run(false)}
          >
            {done ? 'Linked' : 'Link them'}
          </Button>
        </>
      }
    >
      <p>
        Extinguishers, AEDs and fire-alarm devices added before sites existed as records
        carry only the centre name printed on the label. Anything that works by site — the
        site filters, the roll-ups, the blanks filled in on a record — cannot see them.
      </p>
      <p>
        This matches that name against your site list and stores the link. It changes no
        name, on the equipment or on the site: the name on a physical label must not move
        because a link was missing. Running it twice does nothing the second time.
      </p>
      <p>
        A name matching two sites, or a record already linked somewhere the name disagrees
        with, is listed and left alone — and blocks the write until you have settled it.
        Guessing here would file equipment at a site it is not at.
      </p>
    </Job>
  )
}

function DocumentVisibility() {
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(false)

  const run = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'write')
    try {
      const r = await backfillDocumentVisibility({ dryRun })
      setPreview(r)
      if (!dryRun) {
        setDone(true)
        toast.success(`Stamped ${r.written} document${r.written === 1 ? '' : 's'}`)
      } else if (r.wouldWrite === 0) {
        toast.success('Nothing to do — every document is already stamped')
      }
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy('')
    }
  }

  const nothingToDo = preview && preview.wouldWrite === 0

  return (
    <Job
      icon={FileStack}
      title="Stamp document visibility"
      result={preview && [
        `${preview.total} document${preview.total === 1 ? '' : 's'} in this organization`,
        `${preview.alreadyStamped} already stamped`,
        `${preview.wouldWrite} to stamp — ${preview.orgWide} organization-wide, ${preview.siteScoped} site-scoped`,
        preview.titles?.length ? `\n${preview.titles.map((t) => `  · ${t}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')}
      actions={
        <>
          <Button variant="ghost" icon={Play} loading={busy === 'dry'} disabled={Boolean(busy)} onClick={() => run(true)}>
            Check first
          </Button>
          <Button
            icon={done ? Check : undefined}
            loading={busy === 'write'}
            // Deliberately gated on having looked: the check costs one click and
            // this writes to every document in the library.
            disabled={Boolean(busy) || !preview || nothingToDo}
            onClick={() => run(false)}
          >
            {done ? 'Stamped' : 'Stamp them'}
          </Button>
        </>
      }
    >
      <p>
        Documents saved before the Site/Region/Organization levels existed carry no
        visibility marker. The security rules read that marker directly, and a document
        without one is readable by admins, managers and auditors — but not by members.
      </p>
      <p>
        This records the access each document already has. It narrows nothing, and running
        it twice does nothing the second time.
      </p>
    </Job>
  )
}

function OrgClaims() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [token, setToken] = useState(null)

  const run = async () => {
    setBusy(true)
    try {
      const r = await backfillClaims()
      setResult(r)
      toast.success(`${r.stamped} of ${r.total} now carry the organization`)
    } catch (err) {
      toast.error(err?.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // Ground truth, not a count. Counts describe what the job believed it did;
  // this is what the token actually says, which is the only thing the storage
  // rules will read.
  const check = async () => {
    try {
      const { getAuth, getIdTokenResult } = await import('firebase/auth')
      const user = getAuth().currentUser
      if (!user) return toast.error('Not signed in')
      const res = await getIdTokenResult(user, true)
      setToken({ uid: user.uid, orgId: res.claims.orgId ?? null, role: res.claims.role ?? null })
    } catch (err) {
      toast.error(err?.message || 'Failed')
    }
  }

  return (
    <Job
      icon={ShieldCheck}
      title="Put this organization on everyone's sign-in token"
      result={[
        result && [
          `${result.total} member${result.total === 1 ? '' : 's'}`,
          `${result.updated} updated now, ${result.stamped} carry the organization in total`,
          result.notApproved ? `${result.notApproved} not approved — these get no organization, by design` : '',
          result.noAuthUser ? `${result.noAuthUser} have no sign-in account and can never receive one` : '',
          result.failed?.length ? `${result.failed.length} failed — see the function logs` : '',
        ].filter(Boolean).join('\n'),
        token && `\nYour token: ${token.orgId ? `organization ${token.orgId}, role ${token.role}` : 'NO organization — sign out and back in, or run the update above'}`,
      ].filter(Boolean).join('\n') || null}
      actions={
        <>
          <Button icon={Play} loading={busy} onClick={run}>
            {result ? 'Run again' : 'Update tokens'}
          </Button>
          <Button variant="ghost" onClick={check}>Check my token</Button>
        </>
      }
    >
      <p>
        Uploaded files are stored per organization, but the storage rules cannot look a
        person up — they can only read what is on the sign-in token. This puts the
        organization there, for approved members only.
      </p>
      <p>
        New and changed members are handled automatically from now on; this is the one-off
        for people who were already here. Everyone picks it up next time they sign in.
      </p>
    </Job>
  )
}
