import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { orgDepartments } from '../auth/access'

/**
 * Correlated Department → Responsible-person drill-down (mirrors the
 * Region → Entity → Site cascade): choosing a department narrows the people
 * list, and choosing a person back-fills their department.
 *
 * `users` need { name|email, department|dept }. `getValue` decides what the
 * person <option> value is (defaults to uid); `onChange(value, user)` fires
 * with the chosen value and the matching user object.
 */
export default function DeptPersonPicker({
  users = [],
  value = '',
  onChange,
  getValue = (u) => u.uid,
  renderPerson = (u) => u.name || u.email,
  selectClass = 'input',
  personPlaceholder = 'Select person…',
}) {
  const { org } = useAuth()
  const [dept, setDept] = useState('')
  const deptOf = (u) => u.department || u.dept || ''

  const depts = useMemo(
    () => [...new Set([...orgDepartments(org), ...users.map(deptOf).filter(Boolean)])].sort(),
    [org, users]
  )
  const shown = useMemo(() => (dept ? users.filter((u) => deptOf(u) === dept) : users), [users, dept])

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <select className={selectClass} value={dept} onChange={(e) => setDept(e.target.value)} title="Filter people by department">
        <option value="">Select department…</option>
        {depts.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select
        className={selectClass}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          const u = users.find((x) => String(getValue(x)) === v)
          if (u && deptOf(u)) setDept(deptOf(u))
          onChange(v, u)
        }}
      >
        <option value="">{personPlaceholder}</option>
        {shown.map((u) => (
          <option key={getValue(u)} value={getValue(u)}>{renderPerson(u)}</option>
        ))}
      </select>
    </div>
  )
}
