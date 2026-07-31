import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Panel, NoData } from './ui'

const axis = { tickLine: false, axisLine: false, fontSize: 11, tick: { fill: '#8a7660' } }

/**
 * A horizontal bar list.
 *
 * Horizontal because every label here is prose — "Struck by Moving / Falling
 * Object", full site names, entity codes — and prose rotated under a vertical
 * axis is unreadable. These panels exist to be read as labels, not compared as
 * heights, so the layout follows the label.
 */
export default function Breakdown({ title, subtitle, rows = [], color = '#c74a33' }) {
  const height = Math.max(160, rows.length * 34 + 24)
  return (
    <Panel title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <NoData height={160}>Nothing recorded in this scope.</NoData>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
            <XAxis type="number" allowDecimals={false} hide />
            <YAxis
              type="category" dataKey="name" width={150} {...axis}
              tickFormatter={(v) => (String(v).length > 22 ? `${String(v).slice(0, 21)}…` : v)}
            />
            <Tooltip cursor={{ fill: 'rgba(227,204,191,0.35)' }} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
              {rows.map((d) => <Cell key={d.key} fill={d.color || color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}
