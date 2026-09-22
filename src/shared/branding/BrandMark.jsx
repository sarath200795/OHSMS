// ─────────────────────────────────────────────────────────────────────────────
// The WEHS vendor mark, centred in a Liquid Glass slot.
//
// Auth pages used a bare `<img className="h-16 w-16 rounded-3xl">`. The SVG
// already paints its own kraft tile, so a second CSS radius clipped unevenly
// and the artwork's asymmetric inset (more pad top/left than bottom/right)
// read as off-centre. The SVG art is now balanced; this disc covers it with
// `object-cover` + `object-center` so the kraft face fills the glass evenly.
// ─────────────────────────────────────────────────────────────────────────────
import { WE_EHS_MARK } from './OrgMark'

const SIZE = {
  sm: 'h-10 w-10 rounded-2xl',
  md: 'h-12 w-12 rounded-[18px]',
  lg: 'h-16 w-16 rounded-[22px]',
}

/**
 * @param {'sm'|'md'|'lg'} [size='lg']
 * @param {string} [alt='WEHS']  empty when the surrounding link/heading already names it
 */
export default function BrandMark({ size = 'lg', className = '', alt = 'WEHS' }) {
  return (
    <span
      data-tone="brand"
      className={`glass-mark relative grid flex-none place-items-center overflow-hidden p-0 ${SIZE[size] || SIZE.lg} ${className}`}
    >
      <img
        src={WE_EHS_MARK}
        alt={alt}
        aria-hidden={alt ? undefined : 'true'}
        // Cover the disc: the kraft SVG is already a square face. Insetting it
        // left a glass halo that made the mark look high-left; object-cover +
        // overflow-hidden lets the glass radius clip the SVG's own rx evenly.
        className="absolute inset-0 m-auto h-full w-full object-cover object-center"
      />
    </span>
  )
}
