import toast from 'react-hot-toast'
import { isPermissionDenied } from './permissionDenied'
import { writeErrorMessage } from './writeError'

/**
 * Report a caught write/load failure — unless it was an access check.
 *
 * A refused write is expected whenever the UI hid a control the rules also
 * refuse. Toasting that as an error is how "Missing or insufficient
 * permissions" appeared on screens the person was never meant to mutate.
 */
export function toastCaught(err, fallback = 'Could not save', opts = {}) {
  if (isPermissionDenied(err)) return
  const online = opts.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true)
  const text =
    typeof err === 'string'
      ? err
      : writeErrorMessage(err, { ...opts, online }) || err?.message || fallback
  if (isPermissionDenied({ message: text })) return
  toast.error(text || fallback)
}
