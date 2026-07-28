import { useRef, useState } from 'react'
import { Upload, X, FileText, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { readFileAsDataUrl } from '../lib/fileToDataUrl'
import { MAX_FILE_BYTES } from '../lib/constants'

/**
 * Upload + gallery for base64 files. Presentational: parent passes the current
 * `files` and handles persistence via `onAdd(fileObj)` / `onRemove(id)`.
 *  - accept: 'image' (photos) | 'any' (image or PDF, e.g. medical records)
 */
export default function FileUploader({ files = [], onAdd, onRemove, accept = 'image', label = 'Add files', hint, disabled = false }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (e) => {
    const list = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file
    if (!list.length) return
    setBusy(true)
    try {
      for (const file of list) {
        if (accept === 'image' && !file.type.startsWith('image/')) {
          toast.error(`${file.name}: only images allowed`)
          continue
        }
        try {
          const dataUrl = await readFileAsDataUrl(file, MAX_FILE_BYTES)
          await onAdd({ name: file.name, type: file.type, size: file.size, dataUrl })
        } catch (err) {
          toast.error(err.message || `Could not add ${file.name}`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {files.map((f) => (
            <div key={f.id} className="group relative">
              {f.type?.startsWith('image/') ? (
                <img src={f.dataUrl} alt={f.name} className="h-24 w-24 rounded-xl object-cover shadow-clay-sm" />
              ) : (
                <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl bg-clay-surface p-2 text-center shadow-clay-sm">
                  <FileText size={26} className="text-brand-500" />
                  <span className="line-clamp-2 text-[10px] text-ink-500">{f.name}</span>
                </div>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(f.id)}
                  className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-white opacity-0 shadow transition group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <button type="button" className="btn-ghost" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {label}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept === 'image' ? 'image/*' : 'image/*,application/pdf'}
          className="hidden"
          onChange={onPick}
        />
        {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        {disabled && <p className="mt-1 text-xs text-amber-600">Save the incident first to attach files.</p>}
      </div>
    </div>
  )
}
