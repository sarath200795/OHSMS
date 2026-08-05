import { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  ENERGY_SOURCES,
  LOTO_DEVICES,
  energySourceByKey,
  pointDeviceKeys,
} from '../../constants/energySources'
import { fileToCompressedDataUrl } from '../../utils/image'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-steel-400">
        {label}
      </span>
      {children}
    </label>
  )
}

const textareaCls =
  'w-full rounded-lg border border-steel-700 bg-steel-900/70 px-3 py-2 text-sm text-steel-50 outline-none transition-all focus:border-hazard focus:ring-2 focus:ring-hazard/30'

export default function IsolationPointEditor({
  point,
  pointId,
  onChange,
  onRemove,
}) {
  const [uploading, setUploading] = useState(false)
  const src = energySourceByKey(point.energySource) || ENERGY_SOURCES[0]

  const update = (patch) => onChange({ ...point, ...patch })

  const selectedDevices = pointDeviceKeys(point)
  const toggleDevice = (key) => {
    const next = selectedDevices.includes(key)
      ? selectedDevices.filter((k) => k !== key)
      : [...selectedDevices, key]
    update({ devices: next })
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const dataUrl = await fileToCompressedDataUrl(file, { maxDim: 1000, quality: 0.55 })
      update({ photo: dataUrl })
      toast.success('Photo added')
    } catch (err) {
      toast.error(err.message || 'Could not process image')
    } finally {
      setUploading(false)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="overflow-hidden rounded-2xl border border-steel-700 bg-steel-900/50"
    >
      {/* Header strip colored by energy source */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: src.color, color: src.textColor }}
      >
        <div className="flex items-center gap-2 font-bold">
          <span className="grid h-7 w-10 place-items-center rounded bg-black/20 text-sm">
            {pointId}
          </span>
          <span className="text-sm">{src.label}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md bg-black/20 px-2 py-1 text-xs font-semibold hover:bg-black/40"
        >
          Remove
        </button>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <Field label="Energy source">
          <select
            value={point.energySource}
            onChange={(e) => update({ energySource: e.target.value })}
            className={textareaCls}
          >
            {ENERGY_SOURCES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-steel-400">
            LOTO devices <span className="normal-case text-steel-500">(select one or more)</span>
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {LOTO_DEVICES.map((d) => {
              const checked = selectedDevices.includes(d.key)
              return (
                <label
                  key={d.key}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                    checked
                      ? 'border-hazard bg-hazard/10 text-steel-50'
                      : 'border-steel-700 bg-steel-900/70 text-steel-300 hover:border-steel-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDevice(d.key)}
                    className="h-4 w-4 shrink-0 accent-hazard"
                  />
                  <span className="truncate">{d.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          <Field label="Rating / Voltage (optional)">
            <input
              type="text"
              value={point.rating || ''}
              onChange={(e) => update({ rating: e.target.value })}
              placeholder="e.g. 415 V, 6 bar, 200 kg"
              className={textareaCls}
            />
          </Field>
        </div>

        <div className="md:col-span-2">
          <Field label="Isolation details">
            <textarea
              rows={2}
              value={point.isolationDetails}
              onChange={(e) => update({ isolationDetails: e.target.value })}
              placeholder="e.g. Open and lock main breaker CB-12 at MCC-3."
              className={textareaCls}
            />
          </Field>
        </div>

        <Field label="Hazard">
          <textarea
            rows={2}
            value={point.hazard}
            onChange={(e) => update({ hazard: e.target.value })}
            placeholder="e.g. 480V arc-flash; rotating shaft."
            className={textareaCls}
          />
        </Field>

        <Field label="Verification procedure">
          <textarea
            rows={2}
            value={point.verification}
            onChange={(e) => update({ verification: e.target.value })}
            placeholder="e.g. Test for zero voltage with meter; attempt start."
            className={textareaCls}
          />
        </Field>

        <div className="md:col-span-2">
          <Field label="Picture of isolation point">
            <div className="flex items-center gap-3">
              {point.photo ? (
                <img
                  src={point.photo}
                  alt="Isolation point"
                  className="h-20 w-20 rounded-lg border border-steel-700 object-cover"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-steel-700 text-xs text-steel-500">
                  No photo
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-steel-700 px-3 py-2 text-sm font-medium text-steel-200 hover:border-hazard hover:text-amber-600">
                {uploading ? 'Processing…' : point.photo ? 'Replace photo' : 'Add photo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={handlePhoto}
                />
              </label>
            </div>
          </Field>
        </div>
      </div>
    </motion.div>
  )
}
