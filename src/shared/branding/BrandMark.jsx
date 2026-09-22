// ─────────────────────────────────────────────────────────────────────────────
// The WEHS vendor mark, centred in a Liquid Glass slot.
//
// Auth pages used a bare `<img className="h-16 w-16 rounded-3xl">`. The SVG
// already paints its own rounded kraft tile (rx=72), so a second CSS radius
// clipped the corners while the face looked optically off-centre against the
// amber aurora. One square glass disc, equal inset, `object-contain` — the
// kraft face sits dead centre horizontally and vertically. OrgMark keeps the
// same contain + cream pattern for uploaded org logos in the signed-in shell.
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
      className={`glass-mark grid flex-none place-items-center overflow-hidden ${SIZE[size] || SIZE.lg} ${className}`}
    >
      <img
        src={WE_EHS_MARK}
        alt={alt}
        aria-hidden={alt ? undefined : 'true'}
        // Fixed fraction of the disc, not the full box: filling 100% made the
        // kraft corners fight the glass radius and read as clipped high-left.
        className="h-[82%] w-[82%] object-contain"
      />
    </span>
  )
}
