import { useState } from 'react'
import { motion } from 'framer-motion'
import { BODY_VIEWS, BODY_PARTS, BODY_PART_BY_KEY, bodyPartLabel } from '../lib/constants'

// ─────────────────────────────────────────────────────────────────────────────
// Interactive human-body SVG. Each region's id is a BODY_PARTS key, so the
// picker (<BodyMap>), the dropdown, and the dashboard heatmap (<BodyHeatmap>)
// all share one source of truth. Simplified, stylized geometry (not anatomical).
// ─────────────────────────────────────────────────────────────────────────────

// Region geometry per view. Each region = { key, el } where el is the JSX shape
// (no fill — fill is applied by the wrapping <g> so multi-shape regions work).
const FRONT = [
  { key: 'head', el: <ellipse cx="100" cy="34" rx="21" ry="25" /> },
  { key: 'face', el: <ellipse cx="100" cy="44" rx="13" ry="14" /> },
  { key: 'neck', el: <rect x="91" y="56" width="18" height="13" rx="4" /> },
  { key: 'shoulder_l', el: <ellipse cx="68" cy="80" rx="13" ry="11" /> },
  { key: 'shoulder_r', el: <ellipse cx="132" cy="80" rx="13" ry="11" /> },
  { key: 'chest', el: <rect x="72" y="74" width="56" height="40" rx="14" /> },
  { key: 'abdomen', el: <rect x="75" y="116" width="50" height="38" rx="10" /> },
  { key: 'pelvis', el: <path d="M76 156 H124 L118 192 H82 Z" />, c: [100, 173] },
  { key: 'arm_l', el: <rect x="52" y="82" width="14" height="118" rx="7" /> },
  { key: 'arm_r', el: <rect x="134" y="82" width="14" height="118" rx="7" /> },
  { key: 'hand_l', el: <ellipse cx="59" cy="212" rx="10" ry="13" /> },
  { key: 'hand_r', el: <ellipse cx="141" cy="212" rx="10" ry="13" /> },
  { key: 'thigh_l', el: <rect x="80" y="194" width="18" height="60" rx="8" /> },
  { key: 'thigh_r', el: <rect x="102" y="194" width="18" height="60" rx="8" /> },
  { key: 'knee_l', el: <ellipse cx="89" cy="262" rx="11" ry="10" /> },
  { key: 'knee_r', el: <ellipse cx="111" cy="262" rx="11" ry="10" /> },
  { key: 'lowerleg_l', el: <rect x="82" y="272" width="14" height="72" rx="7" /> },
  { key: 'lowerleg_r', el: <rect x="104" y="272" width="14" height="72" rx="7" /> },
  { key: 'foot_l', el: <ellipse cx="87" cy="354" rx="12" ry="8" /> },
  { key: 'foot_r', el: <ellipse cx="113" cy="354" rx="12" ry="8" /> },
  // Joints & extremities (small hotspots, drawn last so they sit on top)
  { key: 'elbow_l', el: <circle cx="59" cy="142" r="7" /> },
  { key: 'elbow_r', el: <circle cx="141" cy="142" r="7" /> },
  { key: 'wrist_l', el: <circle cx="59" cy="198" r="6" /> },
  { key: 'wrist_r', el: <circle cx="141" cy="198" r="6" /> },
  { key: 'thumb_l', el: <ellipse cx="50" cy="210" rx="3.2" ry="5" />, tiny: true },
  { key: 'thumb_r', el: <ellipse cx="150" cy="210" rx="3.2" ry="5" />, tiny: true },
  { key: 'fingers_l', el: <ellipse cx="59" cy="226" rx="9" ry="5" />, tiny: true },
  { key: 'fingers_r', el: <ellipse cx="141" cy="226" rx="9" ry="5" />, tiny: true },
  { key: 'hip_l', el: <circle cx="86" cy="190" r="7" /> },
  { key: 'hip_r', el: <circle cx="114" cy="190" r="7" /> },
  { key: 'ankle_l', el: <circle cx="89" cy="346" r="6" /> },
  { key: 'ankle_r', el: <circle cx="111" cy="346" r="6" /> },
  // Specific fingers (left hand) — tiny tips below the hand
  { key: 'finger_l_index', el: <ellipse cx="53.5" cy="231" rx="1.7" ry="3.4" />, tiny: true },
  { key: 'finger_l_middle', el: <ellipse cx="57.5" cy="233" rx="1.7" ry="3.6" />, tiny: true },
  { key: 'finger_l_ring', el: <ellipse cx="61.5" cy="232" rx="1.7" ry="3.4" />, tiny: true },
  { key: 'finger_l_little', el: <ellipse cx="65" cy="229" rx="1.5" ry="2.8" />, tiny: true },
  // Specific fingers (right hand)
  { key: 'finger_r_index', el: <ellipse cx="146.5" cy="231" rx="1.7" ry="3.4" />, tiny: true },
  { key: 'finger_r_middle', el: <ellipse cx="142.5" cy="233" rx="1.7" ry="3.6" />, tiny: true },
  { key: 'finger_r_ring', el: <ellipse cx="138.5" cy="232" rx="1.7" ry="3.4" />, tiny: true },
  { key: 'finger_r_little', el: <ellipse cx="135" cy="229" rx="1.5" ry="2.8" />, tiny: true },
  // Specific toes (left foot) — tiny tips below the foot
  { key: 'toe_l_big', el: <ellipse cx="79" cy="362" rx="2" ry="2.4" />, tiny: true },
  { key: 'toe_l_2', el: <ellipse cx="83" cy="363" rx="1.5" ry="2.2" />, tiny: true },
  { key: 'toe_l_3', el: <ellipse cx="86.5" cy="364" rx="1.5" ry="2.2" />, tiny: true },
  { key: 'toe_l_4', el: <ellipse cx="90" cy="363" rx="1.4" ry="2" />, tiny: true },
  { key: 'toe_l_little', el: <ellipse cx="93" cy="361" rx="1.3" ry="1.8" />, tiny: true },
  // Specific toes (right foot)
  { key: 'toe_r_big', el: <ellipse cx="121" cy="362" rx="2" ry="2.4" />, tiny: true },
  { key: 'toe_r_2', el: <ellipse cx="117" cy="363" rx="1.5" ry="2.2" />, tiny: true },
  { key: 'toe_r_3', el: <ellipse cx="113.5" cy="364" rx="1.5" ry="2.2" />, tiny: true },
  { key: 'toe_r_4', el: <ellipse cx="110" cy="363" rx="1.4" ry="2" />, tiny: true },
  { key: 'toe_r_little', el: <ellipse cx="107" cy="361" rx="1.3" ry="1.8" />, tiny: true },
]

const BACK = [
  { key: 'nape', el: <ellipse cx="100" cy="34" rx="21" ry="25" /> },
  { key: 'shoulder_l', el: <ellipse cx="68" cy="80" rx="13" ry="11" /> },
  { key: 'shoulder_r', el: <ellipse cx="132" cy="80" rx="13" ry="11" /> },
  { key: 'back_upper', el: <rect x="72" y="74" width="56" height="44" rx="12" /> },
  { key: 'back_lower', el: <rect x="75" y="120" width="50" height="36" rx="10" /> },
  { key: 'buttocks', el: <path d="M76 158 H124 L118 196 H82 Z" />, c: [100, 176] },
  { key: 'arm_l', el: <rect x="52" y="82" width="14" height="118" rx="7" /> },
  { key: 'arm_r', el: <rect x="134" y="82" width="14" height="118" rx="7" /> },
  { key: 'hand_l', el: <ellipse cx="59" cy="212" rx="10" ry="13" /> },
  { key: 'hand_r', el: <ellipse cx="141" cy="212" rx="10" ry="13" /> },
  { key: 'thigh_l', el: <rect x="80" y="198" width="18" height="58" rx="8" /> },
  { key: 'thigh_r', el: <rect x="102" y="198" width="18" height="58" rx="8" /> },
  { key: 'calf_l', el: <rect x="82" y="272" width="14" height="72" rx="7" /> },
  { key: 'calf_r', el: <rect x="104" y="272" width="14" height="72" rx="7" /> },
  { key: 'foot_l', el: <ellipse cx="87" cy="354" rx="12" ry="8" /> },
  { key: 'foot_r', el: <ellipse cx="113" cy="354" rx="12" ry="8" /> },
  { key: 'elbow_l', el: <circle cx="59" cy="142" r="7" /> },
  { key: 'elbow_r', el: <circle cx="141" cy="142" r="7" /> },
  { key: 'wrist_l', el: <circle cx="59" cy="198" r="6" /> },
  { key: 'wrist_r', el: <circle cx="141" cy="198" r="6" /> },
  { key: 'ankle_l', el: <circle cx="89" cy="346" r="6" /> },
  { key: 'ankle_r', el: <circle cx="111" cy="346" r="6" /> },
]

const INTERNAL = [
  { key: 'brain', el: <ellipse cx="100" cy="30" rx="19" ry="21" /> },
  { key: 'spine', el: <rect x="96" y="58" width="8" height="150" rx="4" /> },
  { key: 'lung', el: <g><path d="M96 86 q-22 4 -20 44 q14 6 20 -2 Z" /><path d="M104 86 q22 4 20 44 q-14 6 -20 -2 Z" /></g>, c: [100, 112] },
  { key: 'heart', el: <path d="M104 96 q10 -10 16 0 q4 12 -16 22 q-20 -10 -16 -22 q6 -10 16 0 Z" />, c: [105, 110] },
  { key: 'liver', el: <path d="M74 132 H112 q4 16 -18 22 q-22 0 -20 -22 Z" />, c: [91, 143] },
  { key: 'stomach', el: <ellipse cx="116" cy="140" rx="12" ry="14" /> },
  { key: 'kidney', el: <g><ellipse cx="84" cy="162" rx="7" ry="11" /><ellipse cx="116" cy="162" rx="7" ry="11" /></g>, c: [100, 162] },
  { key: 'intestine', el: <rect x="78" y="172" width="44" height="34" rx="14" /> },
]

const REGIONS = { front: FRONT, back: BACK, internal: INTERNAL }

// Faint base silhouette for context (non-interactive).
function Silhouette({ view }) {
  if (view === 'internal') {
    return <path d="M70 70 Q70 56 100 56 Q130 56 130 70 L128 200 Q100 214 72 200 Z" fill="#eef2f7" />
  }
  return (
    <g fill="#eef2f7">
      <ellipse cx="100" cy="34" rx="23" ry="27" />
      <path d="M70 74 Q100 64 130 74 L150 200 L132 206 L124 150 L122 256 L118 344 L104 346 L100 210 L96 346 L82 344 L78 256 L76 150 L68 206 L50 200 Z" />
    </g>
  )
}

// Label position for a region: explicit `c`, else derived from the shape props.
function centerOf(region) {
  if (region.c) return region.c
  const p = region.el?.props || {}
  if (p.cx != null && p.cy != null) return [Number(p.cx), Number(p.cy)]
  if (p.x != null && p.width != null) return [Number(p.x) + Number(p.width) / 2, Number(p.y) + Number(p.height) / 2]
  return null
}

function Region({ region, mode, selected, count, max, onToggle }) {
  const heat = mode === 'heat'
  let fill, opacity
  if (heat) {
    const t = max ? count / max : 0
    fill = count ? '#6d4c41' : '#cbd5e1'
    opacity = count ? 0.2 + 0.7 * t : 0.18
  } else {
    fill = selected ? '#6d4c41' : '#d7ccc8'
    opacity = selected ? 0.92 : 0.32
  }
  // Count number on the heatmap (skip the tiny finger/toe spots to avoid clutter).
  const center = heat && count > 0 && !region.tiny ? centerOf(region) : null
  return (
    <g>
      <motion.g
        fill={fill}
        fillOpacity={opacity}
        stroke="#795548"
        strokeOpacity={selected || (heat && count) ? 0.7 : 0.25}
        strokeWidth="0.8"
        onClick={onToggle ? () => onToggle(region.key) : undefined}
        className={onToggle ? 'cursor-pointer' : ''}
        whileHover={onToggle ? { scale: 1.04 } : undefined}
        animate={selected ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
        style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
      >
        {region.el}
        <title>{bodyPartLabel(region.key)}{heat ? `: ${count || 0}` : ''}</title>
      </motion.g>
      {center && (
        <g pointerEvents="none">
          <circle cx={center[0]} cy={center[1]} r="6" fill="#fff" stroke="#6d4c41" strokeWidth="0.6" />
          <text x={center[0]} y={center[1]} fontSize="7" fontWeight="800" fill="#4e342e" textAnchor="middle" dominantBaseline="central">{count}</text>
        </g>
      )}
    </g>
  )
}

/** The figure for a given view. `mode`='select'|'heat'. */
function BodyFigure({ view, mode = 'select', value = [], counts = {}, onToggle, height = 320 }) {
  const max = mode === 'heat' ? Math.max(1, ...Object.values(counts)) : 0
  return (
    <svg viewBox="0 0 200 380" height={height} className="mx-auto block">
      <Silhouette view={view} />
      {REGIONS[view].map((r) => (
        <Region
          key={r.key}
          region={r}
          mode={mode}
          selected={value.includes(r.key)}
          count={counts[r.key] || 0}
          max={max}
          onToggle={onToggle}
        />
      ))}
    </svg>
  )
}

function ViewTabs({ view, setView }) {
  return (
    <div className="mx-auto flex w-fit gap-1 rounded-xl bg-clay-surface p-1 shadow-clay-inset">
      {BODY_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => setView(v.key)}
          className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
            view === v.key ? 'bg-brand-500 text-white shadow-clay-sm' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Body-part picker. `value`=string[] of BODY_PARTS keys; `onChange(nextArray)`.
 * Clicking a region toggles it; selected keys are listed as removable chips.
 */
export default function BodyMap({ value = [], onChange, height = 320 }) {
  const [view, setView] = useState('front')
  const toggle = (key) => {
    if (!onChange) return
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key])
  }
  return (
    <div className="space-y-3">
      <ViewTabs view={view} setView={setView} />
      <div className="rounded-2xl bg-clay-surface p-3 shadow-clay-inset">
        <BodyFigure view={view} mode="select" value={value} onToggle={toggle} height={height} />
      </div>
      {/* Dropdown fallback — reaches every part (fingers, wrists, joints, organs) even if hard to tap on the figure. */}
      <select
        className="input"
        value=""
        onChange={(e) => { if (e.target.value) toggle(e.target.value) }}
      >
        <option value="">Add a body part from the list…</option>
        <optgroup label="External — front">
          {BODY_PARTS.filter((b) => b.group === 'external' && b.view === 'front').map((b) => (
            <option key={b.key} value={b.key} disabled={value.includes(b.key)}>{b.label}</option>
          ))}
        </optgroup>
        <optgroup label="External — back">
          {BODY_PARTS.filter((b) => b.group === 'external' && b.view === 'back').map((b) => (
            <option key={b.key} value={b.key} disabled={value.includes(b.key)}>{b.label}</option>
          ))}
        </optgroup>
        <optgroup label="Internal organs">
          {BODY_PARTS.filter((b) => b.group === 'internal').map((b) => (
            <option key={b.key} value={b.key} disabled={value.includes(b.key)}>{b.label}</option>
          ))}
        </optgroup>
      </select>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              className="chip bg-brand-500 text-white"
            >
              {bodyPartLabel(k)} ✕
            </button>
          ))}
        </div>
      )}
      <p className="text-center text-xs text-ink-400">
        Tap a region to mark it. Switch Front / Back / Internal to reach every area.
      </p>
    </div>
  )
}

/**
 * Read-only heatmap for the dashboard. `counts`=object of BODY_PARTS key→count.
 * `onSelect(key)` cross-filters (optional).
 */
export function BodyHeatmap({ counts = {}, onSelect, height = 300 }) {
  const [view, setView] = useState('front')
  // Ranked list of every affected part with its injury count (covers tiny
  // fingers/toes whose number can't legibly sit on the figure).
  const ranked = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-3">
      <ViewTabs view={view} setView={setView} />
      <BodyFigure view={view} mode="heat" counts={counts} onToggle={onSelect} height={height} />
      {ranked.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">Injuries by body part</p>
          <div className="flex flex-wrap gap-1.5">
            {ranked.map(([k, n]) => (
              <button
                key={k}
                type="button"
                onClick={onSelect ? () => onSelect(k) : undefined}
                className={`chip bg-clay-100 text-ink-700 ${onSelect ? 'hover:bg-clay-200' : 'cursor-default'}`}
                title={`${bodyPartLabel(k)}: ${n}`}
              >
                {bodyPartLabel(k)}
                <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-extrabold text-white">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Read-only body diagram for printed/exported reports. Given `parts` (BODY_PARTS
 * keys), renders each relevant view (front / back / internal) with the injured
 * regions highlighted — the same figure the reporting wizard shows, minus the
 * picker/interactivity — plus a labelled chip list.
 */
export function BodyMapStatic({ parts = [], height = 240 }) {
  const list = Array.isArray(parts) ? parts.filter(Boolean) : []
  if (list.length === 0) return null
  // Only show the views that actually contain a marked part.
  const views = BODY_VIEWS.filter((v) => REGIONS[v.key].some((r) => list.includes(r.key)))
  const shown = views.length ? views : BODY_VIEWS.filter((v) => v.key === 'front')
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-start justify-center gap-4">
        {shown.map((v) => (
          <div key={v.key} className="text-center">
            <div className="rounded-2xl bg-clay-surface p-2 shadow-clay-inset print:border print:border-ink-200 print:bg-white print:shadow-none">
              <BodyFigure view={v.key} mode="select" value={list} height={height} />
            </div>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {v.label} view
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-1.5">
        {list.map((k) => (
          <span key={k} className="chip bg-brand-50 text-brand-700">
            {bodyPartLabel(k)}
          </span>
        ))}
      </div>
    </div>
  )
}

// Re-export for callers that want labels without importing constants directly.
export { bodyPartLabel, BODY_PART_BY_KEY }
