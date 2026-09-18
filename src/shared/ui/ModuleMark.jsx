// ─────────────────────────────────────────────────────────────────────────────
// The glass disc a module (or any section) mark sits on.
//
// Portal tiles used a solid Tailwind-500 gradient — leftover from before the
// amber+white kit — so a module read as a neon square on cream paper. One
// wrapper, keyed by the registry `tone`, is what Home, ModuleLoading, page
// headers and stat tiles share, so a mark cannot drift back into a private
// fill. Glyphs stay the lucide/3D meaning; this is only the chrome.
// ─────────────────────────────────────────────────────────────────────────────

import { readableOnTint } from '../lib/contrast'

const SIZE = {
  sm: 'h-10 w-10 rounded-2xl',
  md: 'h-11 w-11 rounded-2xl',
  lg: 'h-[60px] w-[60px] rounded-[22px]',
  xl: 'h-24 w-24 rounded-[28px]',
}

const cx = (...c) => c.filter(Boolean).join(' ')

/**
 * @param {string}  [tone='brand']  registry tone (`red` / `amber` / `blue` / …)
 * @param {string}  [tint]          optional hex, for analytics tiles that carry
 *                                  their own colour rather than a registry tone
 * @param {'sm'|'md'|'lg'|'xl'} [size='md']
 */
export default function ModuleMark({
  tone = 'brand',
  tint,
  size = 'md',
  className,
  children,
  ...rest
}) {
  return (
    <span
      data-tone={tint ? undefined : tone || 'brand'}
      className={cx('glass-mark', SIZE[size] || SIZE.md, className)}
      style={tint ? { '--mark-tint': tint, '--mark-ink': readableOnTint(tint) } : undefined}
      {...rest}
    >
      {children}
    </span>
  )
}
