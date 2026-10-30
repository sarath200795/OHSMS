import { useLocation } from 'react-router-dom'
import { moduleForPath } from '../modules/registry'
import ModuleLogo3D, { has3DLogo } from '../../pages/portal/ModuleLogo3D'
import { ModuleMark, SkeletonDetail } from '../ui'

/**
 * What you look at while a module's chunk downloads.
 *
 * A generic skeleton tells you the app is alive but not what it is doing, and
 * on a slow connection that is several seconds of anonymity. The module's own
 * logo — the one that was just clicked, still moving — says which door you came
 * through and confirms the click landed.
 *
 * The home grid no longer carries `playing` — a resting logo waits for a
 * hover. This screen has nothing to hover, so the wrapper still does, and
 * the same reduced-motion rules stop it.
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
        {/* Same glass disc as the portal tile, so the thing that was clicked and
            the thing that answers are visibly the same object. */}
        <span className="group playing relative [perspective:520px] [transform-style:preserve-3d]">
          <ModuleMark tone={mod.tone} size="xl">
            <ModuleLogo3D moduleKey={mod.key} />
          </ModuleMark>
        </span>

        <div className="text-center">
          <p className="text-sm font-bold text-ink-800">{mod.title || mod.label}</p>
          <p className="mt-0.5 text-xs text-ink-400">Loading…</p>
        </div>
      </div>
    </div>
  )
}
