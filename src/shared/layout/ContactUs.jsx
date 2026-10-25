// Public phone for WEEHS. The legal pages already name info@weehs.org; the
// home screen had no way to reach anyone. A tel: link so a phone can dial it.
// WhatsApp stays a separate bot channel and is not offered here.
import { Phone } from 'lucide-react'

export const CONTACT_PHONE_DISPLAY = '+91 77939 66625'
export const CONTACT_PHONE_TEL = 'tel:+917793966625'

/**
 * Contact us — one tappable phone number on the amber glass surface.
 *
 * The whole row is the link so the hit target is the card, not a line of
 * digits. It sits outside the module grids: those tiles centre their marks
 * on a fixed square, and a contact control inside that grid would share the
 * centring rules it does not need.
 */
export default function ContactUs({ className = '' }) {
  return (
    <a
      href={CONTACT_PHONE_TEL}
      className={`card flex w-full flex-col gap-2 px-4 py-3.5 transition-transform duration-200 ease-emil hover:-translate-y-0.5 active:scale-[0.99] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 sm:flex-row sm:items-center sm:gap-3.5 sm:px-5 ${className}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          data-tone="amber"
          aria-hidden="true"
          className="glass-mark grid h-11 w-11 flex-none place-items-center rounded-2xl"
        >
          <Phone size={20} strokeWidth={2.2} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
          Contact us
        </span>
      </span>
      <span className="whitespace-nowrap text-[17px] font-extrabold tracking-[-0.02em] text-ink-900 sm:text-[18px]">
        {CONTACT_PHONE_DISPLAY}
      </span>
    </a>
  )
}
