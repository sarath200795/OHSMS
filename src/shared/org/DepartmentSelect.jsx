import { useAuth } from '../auth/AuthContext'
import { orgDepartments } from '../auth/access'

/**
 * Department dropdown fed by the org-configured list (Org Settings → General),
 * so admin-added departments populate every module. A legacy/custom current
 * value stays selectable even if it's no longer in the list.
 */
export default function DepartmentSelect({ value = '', onChange, className = 'input', placeholder = 'Select department…', ...rest }) {
  const { org } = useAuth()
  const list = orgDepartments(org)
  const opts = value && !list.includes(value) ? [value, ...list] : list
  return (
    <select className={className} value={value} onChange={onChange} {...rest}>
      <option value="">{placeholder}</option>
      {opts.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  )
}
