// ─────────────────────────────────────────────────────────────────────────────
// Whose product is this?
//
// Two answers, and they are not the same answer. The organization using the app
// owns the top-left corner — that is the identity a person recognises before
// they read anything, and on a shared safety platform "is this my company's
// system" is the first question the corner has to settle. WE EHS is the vendor,
// which is a footnote: true, worth stating, and not what the header is for.
//
// So the org's own logo takes the mark position and the WE EHS mark moves to a
// fixed badge in the bottom-right corner. An organization that has not uploaded
// one falls back to the WE EHS mark in the header, because an empty box is
// worse than a stand-in — nothing about the layout may depend on the upload
// having happened.
//
// Both live here rather than in AppChrome because the breadcrumb bar carries
// the same mark, and two copies of "which logo do we show" is how they drift.
// ─────────────────────────────────────────────────────────────────────────────
import { useAuth } from '../auth/AuthContext'
import { safeSrc } from '../safeUrl'

/** The vendor mark, in /public. Also the fallback identity. */
export const WE_EHS_MARK = '/wehs.svg'

/**
 * The organization's logo, or the WE EHS mark when none is set.
 *
 * `alt` defaults to empty because both call sites sit inside a link that is
 * already named ("WEHS home", "Home") — announcing the mark as well would make
 * the link read twice. Pass one only where the image stands alone.
 */
export function OrgMark({ className = '', alt = '' }) {
  const { org } = useAuth()
  // safeSrc, not the raw field: this URL comes out of a Firestore document that
  // an org admin writes, and an <img src> is fetched without anyone clicking.
  const custom = safeSrc(org?.logoUrl)
  return (
    <img
      src={custom || WE_EHS_MARK}
      alt={alt}
      aria-hidden={alt ? undefined : 'true'}
      // object-contain, not cover: a logo is a shape someone approved, and
      // cropping it to fill a square is the one thing a brand guideline never
      // permits. The white ground keeps a transparent PNG legible on the kraft
      // background it sits against.
      className={`flex-none object-contain ${custom ? 'bg-white' : ''} ${className}`}
    />
  )
}

/**
 * Vendor attribution, pinned to the bottom-right corner of the viewport.
 *
 * z-20 deliberately: Sam's chat panel is z-40 and the idle-timeout dialog is
 * z-50, so this sits under both rather than over the thing a person is reading.
 * pointer-events-none so it can never swallow a click meant for the page.
 * print:hidden because a printed incident report carries its own footer.
 */
export function PoweredByWeEhs() {
  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-20 flex items-center gap-2 rounded-2xl bg-clay-surface/85 px-2.5 py-1.5 shadow-clay-sm backdrop-blur-sm print:hidden"
    >
      <img src={WE_EHS_MARK} alt="" aria-hidden="true" className="h-5 w-5 flex-none rounded-md" />
      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-400">
        Powered by WE EHS
      </span>
    </div>
  )
}
