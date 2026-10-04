import { LOTO_STANDARD, LOTO_STANDARD_TITLE } from '../../constants/permits'

/** The one place the controlling standard is named on screen. */
export default function PermitStandard({ className = '' }) {
  return (
    <p className={`text-xs text-steel-400 ${className}`}>
      Issued under {LOTO_STANDARD} — {LOTO_STANDARD_TITLE}. Each isolation point is locked and
      tagged by an authorised employee, and verified, before work begins.
    </p>
  )
}
