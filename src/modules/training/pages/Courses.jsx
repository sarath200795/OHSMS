import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BookOpen, Plus, Pencil, Trash2, Link2, Paperclip, X, ImagePlus } from 'lucide-react'
import CourseThumb from '../components/CourseThumb'
import { PageHeader, Field, Input, Select, Textarea, Button, Modal, Badge, EmptyState, SkeletonTable } from '../../../shared/ui'
import { useAuth } from '../../../shared/auth/AuthContext'
import { fileToDataUrl } from '../../../shared/lib/files'
import { useTraining } from '../context/TrainingContext'
import { createCourse, updateCourse, deleteCourse, COURSE_CATEGORIES } from '../lib/firestore'
import { DELIVERY_MODES } from '../lib/sessions'

const EMPTY = { name: '', category: 'Induction', deliveryMode: 'module', validityMonths: 12, mandatory: false, description: '', content: [], thumbnail: '' }

const MAX_FILE_BYTES = 700 * 1024

export default function Courses() {
  const { orgId, actor, isManager } = useAuth()
  const { loading, courses, records } = useTraining()
  const [editing, setEditing] = useState(null) // 'new' | course | null
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const [newLink, setNewLink] = useState({ label: '', url: '' })
  const fileRef = useRef(null)

  const openNew = () => { setForm(EMPTY); setNewLink({ label: '', url: '' }); setEditing('new') }
  const openEdit = (c) => {
    setForm({
      name: c.name, category: c.category || 'Other', deliveryMode: c.deliveryMode || 'module', validityMonths: c.validityMonths ?? 0,
      mandatory: !!c.mandatory, description: c.description || '', content: c.content || [],
      thumbnail: c.thumbnail || '',
    })
    setNewLink({ label: '', url: '' })
    setEditing(c)
  }

  const thumbRef = useRef(null)
  const onThumb = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Pick an image file')
    if (file.size > 250 * 1024) return toast.error('Thumbnail too large — keep it under 250 KB')
    const dataUrl = await fileToDataUrl(file)
    setForm((f) => ({ ...f, thumbnail: dataUrl }))
  }

  // ── Learning material (content) editing ──
  const addLink = () => {
    const label = newLink.label.trim()
    let url = newLink.url.trim()
    if (!label || !url) return toast.error('Enter a label and a URL')
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    setForm((f) => ({ ...f, content: [...(f.content || []), { id: `ct-${Date.now()}`, type: 'link', label, url }] }))
    setNewLink({ label: '', url: '' })
  }
  const addFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return toast.error('File too large — keep it under 700 KB (link larger files instead)')
    const dataUrl = await fileToDataUrl(file)
    setForm((f) => ({
      ...f,
      content: [...(f.content || []), { id: `ct-${Date.now()}`, type: 'file', label: file.name, fileName: file.name, dataUrl }],
    }))
  }
  const removeContent = (id) => setForm((f) => ({ ...f, content: (f.content || []).filter((c) => c.id !== id) }))

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Course name is required')
    setBusy(true)
    try {
      if (editing === 'new') { await createCourse(orgId, form, actor); toast.success('Course added') }
      else { await updateCourse(orgId, editing.id, form, actor); toast.success('Course updated') }
      setEditing(null)
    } catch (err) { toast.error(err?.message || 'Failed') } finally { setBusy(false) }
  }

  const remove = async (c) => {
    const used = records.filter((r) => r.courseId === c.id).length
    if (!window.confirm(`Delete course "${c.name}"?${used ? ` ${used} training record(s) will keep their history.` : ''}`)) return
    try { await deleteCourse(orgId, c.id, actor, c.name); toast.success('Course deleted') }
    catch (err) { toast.error(err?.message || 'Failed') }
  }

  return (
    <>
      <PageHeader
        title="Course Catalogue"
        subtitle="Trainings & certifications your organization runs, with validity periods"
        icon={BookOpen}
        actions={isManager && <Button icon={Plus} onClick={openNew}>Add course</Button>}
      />

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Define your catalogue — e.g. Fire Safety, First Aid, Work at Height — then log trainings against it."
          action={isManager && <Button icon={Plus} onClick={openNew}>Add course</Button>}
        />
      ) : (
        /* YouTube-style course grid */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {courses.map((c) => (
            <div key={c.id} className="card group flex flex-col overflow-hidden p-3 transition-transform duration-200 ease-emil hover:-translate-y-0.5">
              <CourseThumb course={c} />
              <div className="flex flex-1 flex-col px-1 pt-3">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="font-bold leading-snug text-ink-900">{c.name}</p>
                  {c.mandatory && <Badge tone="red" className="shrink-0 !py-0 text-[10px]">Mandatory</Badge>}
                </div>
                <p className="text-xs text-ink-500">
                  {c.category || 'Other'} · {c.validityMonths ? `${c.validityMonths}m validity` : 'no expiry'}
                </p>
                <p className="mt-1 text-xs text-ink-400">
                  {(c.content || []).length} material{(c.content || []).length === 1 ? '' : 's'} · {records.filter((r) => r.courseId === c.id).length} completion{records.filter((r) => r.courseId === c.id).length === 1 ? '' : 's'}
                </p>
                {c.description && <p className="mt-1 line-clamp-2 text-xs text-ink-400">{c.description}</p>}
                {isManager && (
                  <div className="mt-auto flex justify-end gap-1 pt-2 opacity-0 transition group-hover:opacity-100">
                    <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => openEdit(c)} title="Edit"><Pencil size={14} /> Edit</button>
                    <button className="btn-ghost px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => remove(c)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add course' : 'Edit course'}>
        <form onSubmit={save} className="space-y-4 p-6">
          <Field label="Course name *" htmlFor="cname">
            <Input id="cname" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fire Safety Awareness" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" htmlFor="ccat">
              <Select id="ccat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {COURSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Validity (months)" htmlFor="cval" hint="0 = certification never expires">
              <Input id="cval" type="number" min="0" max="120" value={form.validityMonths}
                onChange={(e) => setForm({ ...form, validityMonths: e.target.value })} />
            </Field>
          </div>
          {/* How the course is delivered decides what else it needs: only a
              classroom course has a time, a place and a request queue. */}
          <div>
            <label className="label">How is it delivered?</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {DELIVERY_MODES.map((d) => {
                const on = (form.deliveryMode || 'module') === d.key
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setForm({ ...form, deliveryMode: d.key })}
                    className={`rounded-2xl px-4 py-3 text-left transition ${
                      on ? 'bg-clay-surface shadow-clay-inset' : 'bg-clay-surface shadow-clay-sm'
                    }`}
                  >
                    <span className={`block text-sm font-bold ${on ? 'text-brand-700' : 'text-ink-800'}`}>{d.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-400">{d.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-700">
            <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} />
            Mandatory for all employees
          </label>
          <Field label="Description (optional)" htmlFor="cdesc">
            <Textarea id="cdesc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          {/* Thumbnail (YouTube-style course card art) */}
          <div>
            <label className="label">Thumbnail (optional)</label>
            <div className="flex items-center gap-3">
              <div className="w-40 shrink-0"><CourseThumb course={form} /></div>
              <div className="flex flex-col gap-1.5">
                <Button type="button" variant="soft" icon={ImagePlus} onClick={() => thumbRef.current?.click()}>
                  {form.thumbnail ? 'Replace image' : 'Upload image'}
                </Button>
                {form.thumbnail && (
                  <button type="button" className="text-xs font-semibold text-red-600 hover:underline"
                    onClick={() => setForm((f) => ({ ...f, thumbnail: '' }))}>
                    Remove — use category art
                  </button>
                )}
                <p className="text-xs text-ink-400">Image up to 250 KB. Without one, the category art is used.</p>
              </div>
              <input ref={thumbRef} type="file" accept="image/*" className="hidden" onChange={onThumb} />
            </div>
          </div>

          {/* Learning material shown to employees in My Learning */}
          <div>
            <label className="label">Learning material (optional)</label>
            {(form.content || []).length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {form.content.map((c) => (
                  <span key={c.id} className="chip bg-clay-100 text-ink-700">
                    {c.type === 'file' ? <Paperclip size={12} /> : <Link2 size={12} />} {c.label}
                    <button type="button" onClick={() => removeContent(c.id)} className="text-ink-400 hover:text-red-600"><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,1.4fr,auto,auto]">
              <Input placeholder="Label — e.g. Slides" value={newLink.label}
                onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
              <Input placeholder="https://…" value={newLink.url}
                onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} />
              <Button type="button" variant="soft" icon={Link2} onClick={addLink}>Add link</Button>
              <Button type="button" variant="soft" icon={Paperclip} onClick={() => fileRef.current?.click()}>Add file</Button>
              <input ref={fileRef} type="file" className="hidden" onChange={addFile} />
            </div>
            <p className="mt-1 text-xs text-ink-400">Files up to 700 KB are stored inline; link larger material (videos, e-learning).</p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" loading={busy}>{editing === 'new' ? 'Add course' : 'Save changes'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
