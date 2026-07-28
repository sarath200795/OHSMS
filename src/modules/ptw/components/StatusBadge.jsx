import { Badge } from './ui'
import { statusMeta } from '../lib/permitStatus'

/** A pill showing a permit's derived status in its status color. */
export default function StatusBadge({ status, soft = true }) {
  const meta = statusMeta(status)
  return <Badge color={meta.color} soft={soft}>{meta.label}</Badge>
}
