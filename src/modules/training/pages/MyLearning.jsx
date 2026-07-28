import { useState } from 'react'
import toast from 'react-hot-toast'
import { BookOpenCheck, GraduationCap, Link2, Paperclip, CheckCircle2, CalendarClock, BadgeCheck, Award } from 'lucide-react'
import { PageHeader, Card, Badge, Button, EmptyState, SkeletonCard } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { formatDate, daysUntil } from '../../../shared/lib/format'
import { useTraining } from '../context/TrainingContext'
import { selfCompleteTraining } from '../lib/firestore'
import { assignmentStatus, ASSIGNMENT_META, recordStatus, STATUS_META, todayISO } from '../lib/status'
import CertificateModal from '../components/Certificate'
import CourseThumb from '../components/CourseThumb'

/** Learning material chips for a course (links open, files download). */
function ContentList({ course }) {
  const items = course?.content || []
  if (!items.length) return <p className="text-xs italic text-ink-400">No learning material attached — complete this as instructed by your trainer.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((c) => (
        <a
          key={c.id}
          href={c.type === 'file' ? c.dataUrl : c.url}
          target="_blank"
          rel="noreferrer"
          download={c.type === 'file' ? c.fileName || c.label : undefined}
          className="chip bg-brand-50 text-brand-700 transition hover:bg-brand-100"
        >
          {c.type === 'file' ? <Paperclip size={12} /> : <Link2 size={12} />} {c.label}
        </a>
      ))}
    </div>
  )
}

export default function MyLearning() {
  const { orgId, orgName, profile, actor } = useAuth()
  const { loading, courses, myAssignments, myRecords } = useTraining()
  const [busyId, setBusyId] = useState(null)
  const [certRecord, setCertRecord] = useState(null)
  const today = todayISO()

  // Courses not currently assigned to me — the browsable catalogue.
  const availableCourses = courses.filter((c) => !myAssignments.some((a) => a.courseId === c.id))

  // Self-complete a course directly from the catalogue (no assignment needed).
  const completeCourse = async (course) => {
    setBusyId(`course-${course.id}`)
    try {
      const ids = myAssignments.filter((a) => a.courseId === course.id).map((a) => a.id)
      await selfCompleteTraining(orgId, { course, profile, assignmentIds: ids }, actor)
      toast.success(`"${course.name}" marked completed`)
    } catch (e) {
      toast.error(e?.message || 'Could not complete the training')
    } finally {
      setBusyId(null)
    }
  }

  const complete = async (assignment) => {
    const course = courses.find((c) => c.id === assignment.courseId)
    if (!course) return toast.error('Course no longer exists — ask an admin')
    setBusyId(assignment.id)
    try {
      // Close every open assignment of mine for this course in the same batch.
      const ids = myAssignments.filter((a) => a.courseId === course.id).map((a) => a.id)
      await selfCompleteTraining(orgId, { course, profile, assignmentIds: ids }, actor)
      toast.success(`"${course.name}" marked completed`)
    } catch (e) {
      toast.error(e?.message || 'Could not complete the training')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title="My Learning" subtitle="Your assigned trainings and certifications" icon={BookOpenCheck} />
        <SkeletonCard className="max-w-3xl" />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="My Learning"
        subtitle={`${profile?.name ? profile.name.split(' ')[0] + ' — ' : ''}your assigned trainings and certifications`}
        icon={BookOpenCheck}
      />

      {/* Assigned to me */}
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-800">
        <CalendarClock size={17} className="text-brand-600" /> Assigned to me ({myAssignments.length})
      </h3>
      {myAssignments.length === 0 ? (
        <Card className="mb-6">
          <EmptyState icon={CheckCircle2} title="Nothing assigned" description="You're all caught up — assigned trainings will appear here." />
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {myAssignments.map((a) => {
            const st = assignmentStatus(a.dueDate, today)
            const meta = ASSIGNMENT_META[st]
            const course = courses.find((c) => c.id === a.courseId)
            const d = daysUntil(a.dueDate)
            return (
              <Card key={a.id} className="!p-4" style={{ boxShadow: `inset 4px 0 0 ${meta.color}` }}>
                <CourseThumb course={course || { category: a.category }} className="mb-3" />
                <div className="mb-1.5 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink-900">{a.courseName}</p>
                    <p className="text-xs text-ink-500">{a.category || course?.category || ''}{a.assignedByName ? ` · assigned by ${a.assignedByName}` : ''}</p>
                  </div>
                  <Badge tone={meta.tone}>
                    {a.dueDate ? <>Due {formatDate(a.dueDate)}{d != null && d < 0 ? ` · ${Math.abs(d)}d overdue` : ''}</> : meta.label}
                  </Badge>
                </div>
                <div className="mb-4 mt-3">
                  <ContentList course={course} />
                </div>
                <Button icon={CheckCircle2} loading={busyId === a.id} onClick={() => complete(a)}>
                  Mark completed
                </Button>
              </Card>
            )
          })}
        </div>
      )}

      {/* Available trainings (full catalogue, YouTube-style) */}
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-800">
        <GraduationCap size={17} className="text-brand-600" /> Available trainings ({availableCourses.length})
      </h3>
      {availableCourses.length === 0 ? (
        <Card className="mb-6">
          <EmptyState icon={GraduationCap} title="No other courses" description="Every catalogue course is already assigned to you." />
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {availableCourses.map((c) => (
            <Card key={c.id} className="flex flex-col !p-4">
              <CourseThumb course={c} className="mb-3" />
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="font-bold leading-snug text-ink-900">{c.name}</p>
                {c.mandatory && <Badge tone="red" className="shrink-0 !py-0 text-[10px]">Mandatory</Badge>}
              </div>
              <p className="text-xs text-ink-500">{c.category || 'Other'} · {c.validityMonths ? `${c.validityMonths}m validity` : 'no expiry'}</p>
              <div className="my-3"><ContentList course={c} /></div>
              <div className="mt-auto">
                <Button variant="soft" icon={CheckCircle2} loading={busyId === `course-${c.id}`} onClick={() => completeCourse(c)}>
                  Complete training
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* My certifications */}
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-ink-800">
        <BadgeCheck size={17} className="text-green-600" /> My certifications ({myRecords.length})
      </h3>
      {myRecords.length === 0 ? (
        <Card>
          <EmptyState icon={GraduationCap} title="No trainings recorded yet" description="Completed trainings and their expiry dates will show here." />
        </Card>
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Certificate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-clay-200/60">
                {myRecords.map((r) => {
                  const st = recordStatus(r.expiresOn, today)
                  return (
                    <tr key={r.id} className="hover:bg-clay-100/50">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-ink-900">{r.courseName}</span>
                        {r.loggedBy === 'self' && <span className="ml-2 text-[10px] font-semibold uppercase text-ink-400">Self-declared</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-700">{formatDate(r.completedOn)}</td>
                      <td className="px-4 py-3 text-ink-700">{r.expiresOn ? formatDate(r.expiresOn) : '—'}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_META[st].tone}>{STATUS_META[st].label}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <button className="btn-ghost px-2.5 py-1.5 text-xs text-amber-600" title="View certificate" onClick={() => setCertRecord(r)}>
                          <Award size={14} /> View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CertificateModal record={certRecord} orgName={orgName} onClose={() => setCertRecord(null)} />
    </>
  )
}
