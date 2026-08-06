import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useReactToPrint } from 'react-to-print'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ClipboardList, Check, ChevronLeft, ChevronRight, Printer, Save, Loader2, ShieldAlert, CheckCircle2, Lock,
} from 'lucide-react'
import { PageHeader, Spinner } from '../components/ui'
import StepInitialReport from '../components/wizard/StepInitialReport'
import StepInjuryReports from '../components/wizard/StepInjuryReports'
import StepTeam from '../components/wizard/StepTeam'
import StepCapa from '../components/wizard/StepCapa'
import StepHorizontal from '../components/wizard/StepHorizontal'
import StepInvestigation from '../components/wizard/StepInvestigation'
import FileUploader from '../components/FileUploader'
import IncidentReportDoc from '../components/IncidentReportDoc'
import { useAuth } from '../context/AuthContext'
import { useIncidents } from '../context/IncidentContext'
import { can } from '../lib/permissions'
import { typeRequiresInjury, LIFECYCLE_KEYS, MAX_FILE_BYTES } from '../lib/constants'
import { dataUrlBytes } from '../lib/diagramExport'
import {
  createIncident, updateIncident, getIncident, closeIncident,
  subscribeIncidentPhotos, addIncidentPhoto, deleteIncidentPhoto,
} from '../lib/incidents'
import { syncIncidentInjuries } from '../lib/injuries'

// Forward-only lifecycle: never downgrade when revisiting an earlier step.
const forwardLifecycle = (current, target) =>
  LIFECYCLE_KEYS.indexOf(target) > LIFECYCLE_KEYS.indexOf(current) ? target : current

const STEP_META = {
  initial: { label: 'Initial Report', stage: 'initial' },
  injury: { label: 'Injury Reports', stage: 'initial' },
  team: { label: 'Investigation Team', stage: 'team' },
  investigation: { label: 'Investigation', stage: 'investigation' },
  capa: { label: 'CAPA Actions', stage: 'capa' },
  horizontal: { label: 'Horizontal Deployment', stage: 'horizontal' },
}

export default function IncidentWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user, profile, role, orgId } = useAuth()
  const { users, org, injuries, sites } = useIncidents()
  const actor = useMemo(() => ({ uid: user?.uid, name: profile?.name || '' }), [user, profile])

  const [incident, setIncident] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [saving, setSaving] = useState(false)
  const [photos, setPhotos] = useState([])

  // Working copy for Step 1 (so we can create the doc on first save).
  const [draft, setDraft] = useState({
    incidentDate: '', incidentTime: '', type: '', severity: '', category: '', location: '',
    region: '', entity: '', siteId: '', site: '', narrative: '', affectedPersonnel: [],
  })
  const [injuryReports, setInjuryReports] = useState([])
  const [team, setTeam] = useState([])
  const [capa, setCapa] = useState([])
  const [horizontal, setHorizontal] = useState({ required: null, locations: [], details: '' })

  // Load existing incident + its photos.
  useEffect(() => {
    if (!id || !orgId) return
    let live = true
    getIncident(orgId, id).then((inc) => {
      if (!live || !inc) return
      setIncident(inc)
      setDraft({
        incidentDate: inc.incidentDate || '', incidentTime: inc.incidentTime || '',
        type: inc.type || '', severity: inc.severity || '', category: inc.category || '',
        location: inc.location || '', region: inc.region || '', entity: inc.entity || '',
        siteId: inc.siteId || '', site: inc.site || '',
        narrative: inc.narrative || '', probableCause: inc.probableCause || '',
        affectedPersonnel: inc.affectedPersonnel || [],
      })
      setInjuryReports(inc.injuryReports || [])
      setTeam(inc.team || [])
      setCapa(inc.capa || [])
      setHorizontal(inc.horizontal || { required: null, locations: [], details: '' })
      setLoading(false)
    })
    const unsub = subscribeIncidentPhotos(orgId, id, setPhotos)
    return () => { live = false; unsub() }
  }, [id, orgId])

  const type = draft.type || incident?.type
  const requiresInjury = typeRequiresInjury(type)
  const steps = useMemo(
    () => ['initial', requiresInjury ? 'injury' : null, 'team', 'investigation', 'capa', 'horizontal'].filter(Boolean),
    [requiresInjury]
  )
  const step = params.get('step') && steps.includes(params.get('step')) ? params.get('step') : 'initial'
  const stepIndex = steps.indexOf(step)
  const goStep = (s) => setParams({ step: s }, { replace: false })

  const canInvestigate = can(role, 'incident.investigate')
  const isAdmin = role === 'admin'
  // Once an incident is SAVED, its submitted facts (Step 1) are admin-only to edit.
  const lockInitial = Boolean(incident) && !isAdmin
  // Verified injuries are locked everywhere (unverify on the Injury Reports page to change).
  const verifiedPersonIds = useMemo(
    () => new Set(injuries.filter((j) => j.incidentId === incident?.id && j.status === 'verified').map((j) => j.personId)),
    [injuries, incident]
  )

  // ── Photo helpers ──
  const addPhoto = async (fileObj) => {
    if (!incident) return
    await addIncidentPhoto(orgId, incident.id, { ...fileObj, uploadedBy: actor.name })
  }
  const removePhoto = async (photoId) => {
    if (!incident) return
    await deleteIncidentPhoto(orgId, incident.id, photoId)
  }

  // ── Step saves ──
  const validInitial = () => {
    if (!draft.type) return 'Select an incident type'
    if (!draft.severity) return 'Select a severity level'
    if (!draft.category) return 'Select an HSE category'
    if (!draft.incidentDate) return 'Pick the date of the incident'
    return null
  }

  const nextStep = () => steps[Math.min(stepIndex + 1, steps.length - 1)]

  const saveInitial = async () => {
    const err = validInitial()
    if (err) return toast.error(err)
    setSaving(true)
    try {
      if (!incident) {
        const newId = await createIncident(orgId, actor, { ...draft })
        await updateIncident(orgId, newId, { 'stagesDone.initial': true }, { silent: true })
        toast.success('Incident created')
        navigate(`/incidents/${newId}?step=${requiresInjury ? 'injury' : 'team'}`, { replace: true })
      } else {
        await updateIncident(orgId, incident.id, {
          ...draft,
          'stagesDone.initial': true,
          lifecycle: incident.lifecycle === 'reporting' ? 'reporting' : incident.lifecycle,
        }, { actor, summary: 'Updated initial report' })
        const fresh = await getIncident(orgId, incident.id)
        setIncident(fresh)
        toast.success('Saved')
        goStep(nextStep())
      }
    } catch (e) {
      toast.error(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const saveInjury = async () => {
    setSaving(true)
    try {
      await updateIncident(orgId, incident.id, { injuryReports }, { actor, summary: 'Updated injury reports' })
      const fresh = await getIncident(orgId, incident.id)
      setIncident(fresh)
      // Mirror each injury into the standalone, verifiable Injury Reports collection.
      await syncIncidentInjuries(orgId, fresh, injuryReports, actor).catch((e) =>
        console.warn('[Incident IRA] injury sync skipped:', e?.message || e))
      toast.success('Injury reports saved')
      goStep(nextStep())
    } catch (e) {
      toast.error(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const persist = async (updates, opts, nextKey) => {
    setSaving(true)
    try {
      await updateIncident(orgId, incident.id, updates, { actor, ...opts })
      const fresh = await getIncident(orgId, incident.id)
      setIncident(fresh)
      toast.success('Saved')
      if (nextKey) goStep(nextKey)
    } catch (e) {
      toast.error(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const saveTeam = () => persist(
    { team, 'stagesDone.team': true, lifecycle: forwardLifecycle(incident.lifecycle, 'investigation_team') },
    { summary: 'Updated investigation team' }, nextStep())
  const saveCapa = () => persist(
    { capa, 'stagesDone.capa': true, lifecycle: forwardLifecycle(incident.lifecycle, 'capa') },
    { summary: 'Updated CAPA actions' }, nextStep())
  const saveInvestigation = async (investigations, { activeId, png } = {}) => {
    setSaving(true)
    try {
      // Re-export the diagram PNG only for the currently active investigation;
      // every other entry keeps its previously captured image.
      let next = investigations
      const active = investigations.find((e) => e.id === activeId)
      if (active && png) {
        const bytes = dataUrlBytes(png)
        if (bytes <= MAX_FILE_BYTES) {
          if (active.pngPhotoId) { try { await deleteIncidentPhoto(orgId, incident.id, active.pngPhotoId) } catch { /* ignore */ } }
          const pngPhotoId = await addIncidentPhoto(orgId, incident.id, { name: 'investigation-diagram.png', type: 'image/png', size: bytes, dataUrl: png, kind: 'diagram', uploadedBy: actor.name })
          next = investigations.map((e) => (e.id === activeId ? { ...e, pngPhotoId } : e))
        } else {
          toast('Diagram image too large to attach — saved data only.', { icon: '⚠️' })
        }
      }
      await updateIncident(orgId, incident.id, {
        investigations: next,
        'stagesDone.investigation': true,
        lifecycle: forwardLifecycle(incident.lifecycle, 'investigation'),
      }, { actor, summary: `Investigation saved (${next.map((e) => e.method).join(', ') || 'none'})` })
      const fresh = await getIncident(orgId, incident.id)
      setIncident(fresh)
      toast.success('Investigation saved')
      goStep(nextStep())
    } catch (e) {
      toast.error(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const saveHorizontal = async () => {
    setSaving(true)
    try {
      await updateIncident(orgId, incident.id, { horizontal: { ...horizontal, completedAt: new Date().toISOString() } }, { actor, silent: true })
      await closeIncident(orgId, incident.id, actor)
      toast.success('Incident closed')
      navigate('/incidents')
    } catch (e) {
      toast.error(e.message || 'Could not close')
    } finally {
      setSaving(false)
    }
  }

  // ── Printable Initial Report ──
  const printRef = useRef(null)
  const fullRef = useRef(null)
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: incident ? `${incident.refNo}-initial-report` : 'initial-report',
  })
  const handlePrintFull = useReactToPrint({
    content: () => fullRef.current,
    documentTitle: incident ? `${incident.refNo}-full-report` : 'full-report',
  })
  const diagramPhoto = useMemo(
    () => photos.find((p) => p.id === incident?.investigation?.pngPhotoId) || photos.filter((p) => p.kind === 'diagram').slice(-1)[0],
    [photos, incident]
  )

  if (loading) return <div className="grid h-64 place-items-center"><Spinner size={28} className="text-brand-500" /></div>

  return (
    <div>
      <PageHeader
        title={incident ? `Incident ${incident.refNo}` : 'Report Incident'}
        subtitle="Five-step incident reporting & investigation"
        icon={ClipboardList}
      >
        {incident && (
          <>
            <button className="btn-ghost" onClick={handlePrint}><Printer size={16} /> Initial Report</button>
            <button className="btn-ghost" onClick={handlePrintFull}><Printer size={16} /> Full Report</button>
          </>
        )}
      </PageHeader>

      {/* Stepper */}
      <div className="card mb-6 flex flex-wrap gap-1 p-2">
        {steps.map((s, i) => {
          const done = incident?.stagesDone?.[STEP_META[s].stage]
          const active = s === step
          return (
            <button
              key={s}
              onClick={() => incident && goStep(s)}
              disabled={!incident && s !== 'initial'}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition disabled:opacity-40 ${
                active ? 'bg-brand-500 text-white shadow-clay-brand' : done ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-clay-100'
              }`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${active ? 'bg-white/25' : done ? 'bg-brand-500 text-white' : 'bg-clay-200 text-ink-500'}`}>
                {done && !active ? <Check size={12} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{STEP_META[s].label}</span>
            </button>
          )
        })}
      </div>

      <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {step === 'initial' && (
          <div className="space-y-6">
            {lockInitial && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                <Lock size={15} /> This incident has been saved — its report details can now only be edited by an admin.
              </div>
            )}
            <div className="card p-6">
              <StepInitialReport value={draft} onChange={setDraft} users={users} sites={sites} readOnly={lockInitial} />
            </div>
            {incident && (
              <div className="card p-6">
                <h3 className="mb-1 font-bold text-ink-900">Photographic evidence</h3>
                <p className="mb-3 text-sm text-ink-400">Attach photos from the scene.</p>
                <FileUploader
                  accept="image"
                  label="Add photo"
                  hint="Images up to 10 MB each."
                  disabled={lockInitial}
                  files={photos.filter((p) => p.kind === 'photo')}
                  onAdd={(f) => addPhoto({ ...f, kind: 'photo' })}
                  onRemove={removePhoto}
                />
              </div>
            )}
          </div>
        )}

        {step === 'injury' && (
          <StepInjuryReports
            persons={incident?.affectedPersonnel || []}
            value={injuryReports}
            onChange={setInjuryReports}
            photos={photos.filter((p) => p.kind === 'medical_record')}
            onAddPhoto={addPhoto}
            onRemovePhoto={removePhoto}
            canEdit={Boolean(incident)}
            lockedPersonIds={verifiedPersonIds}
          />
        )}

        {step === 'team' && (canInvestigate ? <StepTeam value={team} onChange={setTeam} users={users} /> : <NoAccess />)}
        {step === 'investigation' && (canInvestigate ? <StepInvestigation incident={incident} onPersist={saveInvestigation} saving={saving} /> : <NoAccess />)}
        {step === 'capa' && (canInvestigate ? <StepCapa value={capa} onChange={setCapa} users={users} /> : <NoAccess />)}
        {step === 'horizontal' && (canInvestigate ? <StepHorizontal value={horizontal} onChange={setHorizontal} /> : <NoAccess />)}
      </motion.div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between">
        <button
          className="btn-ghost"
          disabled={stepIndex === 0}
          onClick={() => goStep(steps[Math.max(stepIndex - 1, 0)])}
        >
          <ChevronLeft size={16} /> Back
        </button>

        <div className="flex gap-2">
          {step === 'initial' && (
            lockInitial ? (
              <button className="btn-primary" onClick={() => goStep(nextStep())}>
                Continue <ChevronRight size={16} />
              </button>
            ) : (
              <button className="btn-primary" onClick={saveInitial} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {incident ? 'Save & continue' : 'Create incident'}
              </button>
            )
          )}
          {step === 'injury' && (
            <button className="btn-primary" onClick={saveInjury} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save & continue
            </button>
          )}
          {step === 'team' && canInvestigate && (
            <button className="btn-primary" onClick={saveTeam} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save & continue
            </button>
          )}
          {step === 'capa' && canInvestigate && (
            <button className="btn-primary" onClick={saveCapa} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save & continue
            </button>
          )}
          {step === 'horizontal' && canInvestigate && (
            <button className="btn-primary" onClick={saveHorizontal} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Close Incident
            </button>
          )}
          {step === 'investigation' && stepIndex < steps.length - 1 && (
            <button className="btn-ghost" onClick={() => goStep(nextStep())}>Next <ChevronRight size={16} /></button>
          )}
        </div>
      </div>

      {/* Hidden printables */}
      <div className="hidden">
        <IncidentReportDoc ref={printRef} incident={incident} photos={photos} org={org} full={false} />
        <IncidentReportDoc ref={fullRef} incident={incident} photos={photos} org={org} full diagramUrl={diagramPhoto?.dataUrl} />
      </div>
    </div>
  )
}

function NoAccess() {
  return (
    <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-800">
      <ShieldAlert className="mx-auto mb-2" size={28} />
      <p className="font-bold">Investigator access required</p>
      <p className="text-sm">Steps 2–5 (team, investigation, CAPA, horizontal deployment) are available to Investigators and Admins.</p>
    </div>
  )
}
