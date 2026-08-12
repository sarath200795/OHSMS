import { useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, FileStack, Play, Check, Bug, Unlock, QrCode } from 'lucide-react'
import { Card, Button } from '../../shared/ui'
import { backfillDocumentVisibility, backfillClaims, clearOrphanedDefectLocks } from '../../shared/functions'
import { reportError } from '../../shared/monitoring'
import { useAuth } from '../../shared/auth/AuthContext'
import { backfillProcedureMirrors } from '../../modules/loto/services/procedures'

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
      <OrgClaims />
      <ProcedureMirrors />
      <DefectLocks />
      <ErrorReporting />
    </div>
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
