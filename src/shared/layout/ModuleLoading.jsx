import { useLocation } from 'react-router-dom'
import { moduleForPath } from '../modules/registry'
import ModuleLogo3D, { has3DLogo } from '../../pages/portal/ModuleLogo3D'
import { SkeletonDetail } from '../ui'

/**
 * What you look at while a module's chunk downloads.
 *
 * A generic skeleton tells you the app is alive but not what it is doing, and
 * on a slow connection that is several seconds of anonymity. The module's own
 * logo — the one that was just clicked, still moving — says which door you came
 * through and confirms the click landed.
 *
 * The logos normally animate on hover; nothing is hovering here, so the wrapper
 * carries `playing`, which every animation in ModuleLogo3D also answers to.
 *
 * Falls back to the skeleton for modules with no 3D logo rather than inventing
 * a shape that means something else.
 */

export { moduleForPath }

export default function ModuleLoading() {
  const { pathname } = useLocation()
  const mod = moduleForPath(pathname)

  if (!mod || !has3DLogo(mod.key)) return <SkeletonDetail />

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        {/* Same tile treatment as the portal, so the thing that was clicked and
            the thing that answers are visibly the same object. */}
        <span
          className={`group playing relative grid h-24 w-24 place-items-center rounded-[1.6rem] bg-gradient-to-br ${
            TONE[mod.tone] || TONE.brand
          } shadow-clay-lg [perspective:520px] [transform-style:preserve-3d]`}
        >
          <ModuleLogo3D moduleKey={mod.key} />
        </span>

        <div className="text-center">
          <p className="text-sm font-bold text-ink-800">{mod.title || mod.label}</p>
          <p className="mt-0.5 text-xs text-ink-400">Loading…</p>
        </div>
      </div>
    </div>
  )
}

// The tile gradients, keyed by the registry's `tone`.
const TONE = {
  red: 'from-rose-500 to-red-600',
  amber: 'from-amber-500 to-orange-600',
  blue: 'from-sky-500 to-blue-600',
  green: 'from-emerald-500 to-green-600',
  violet: 'from-violet-500 to-purple-600',
  brand: 'from-brand-500 to-brand-700',
  slate: 'from-slate-500 to-slate-700',
}
