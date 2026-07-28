import { useState, useRef, useEffect } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { Trash2 } from 'lucide-react'

// A single flexible node used by every investigation method. Behaviour is driven
// by data: { label, kind, flow, color, gateType }.
//   kind: 'box' | 'root' | 'diamond' | 'circle' | 'gate'
//   flow: 'vertical' (handles top/bottom) | 'horizontal' (left/right)
export default function EditableNode({ id, data, selected }) {
  const { setNodes, setEdges } = useReactFlow()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(data.label || '')
  const inputRef = useRef(null)

  useEffect(() => { setText(data.label || '') }, [data.label])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, label: text } } : n)))
  }
  const remove = () => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
  }
  const toggleGate = () => setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, gateType: n.data.gateType === 'AND' ? 'OR' : 'AND' } } : n)))

  const flow = data.flow || 'vertical'
  const targetPos = flow === 'vertical' ? Position.Top : Position.Left
  const sourcePos = flow === 'vertical' ? Position.Bottom : Position.Right
  const color = data.color || '#795548'

  const label = (
    editing ? (
      <textarea
        ref={inputRef}
        className="w-full resize-none rounded bg-white/90 p-1 text-center text-xs text-ink-900 outline-none"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() } }}
      />
    ) : (
      <span className="block w-full whitespace-pre-wrap break-words px-1 text-center text-xs font-semibold leading-tight" style={{ overflowWrap: 'anywhere', fontFamily: 'Arial, Helvetica, sans-serif' }}>{data.label || 'Double-click to edit'}</span>
    )
  )

  const toolbar = selected && (
    <div className="absolute -top-7 left-1/2 flex -translate-x-1/2 gap-1">
      {data.kind === 'gate' && (
        <button onClick={toggleGate} className="rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{data.gateType === 'AND' ? '→ OR' : '→ AND'}</button>
      )}
      <button onClick={remove} className="grid h-5 w-5 place-items-center rounded bg-red-500 text-white"><Trash2 size={11} /></button>
    </div>
  )

  // Shape wrappers
  const handles = (
    <>
      <Handle type="target" position={targetPos} className="!h-2 !w-2 !border-2 !border-white" style={{ background: color }} />
      <Handle type="source" position={sourcePos} className="!h-2 !w-2 !border-2 !border-white" style={{ background: color }} />
    </>
  )

  const common = 'relative flex items-center justify-center text-ink-900'
  const onDouble = () => setEditing(true)

  if (data.kind === 'diamond') {
    return (
      <div className={`${common}`} style={{ width: 110, height: 110 }} onDoubleClick={onDouble}>
        {toolbar}
        <div className="absolute inset-0 m-auto" style={{ width: 78, height: 78, transform: 'rotate(45deg)', background: '#fff', border: `2px solid ${color}`, borderRadius: 8, boxShadow: selected ? `0 0 0 3px ${color}40` : 'none' }} />
        <div className="relative z-10 w-[88px]">{label}</div>
        {handles}
      </div>
    )
  }
  if (data.kind === 'circle') {
    return (
      <div className={`${common} rounded-full bg-white`} style={{ width: 84, height: 84, border: `2px solid ${color}`, boxShadow: selected ? `0 0 0 3px ${color}40` : 'none' }} onDoubleClick={onDouble}>
        {toolbar}{label}{handles}
      </div>
    )
  }
  if (data.kind === 'gate') {
    return (
      <div className={`${common}`} style={{ width: 96 }} onDoubleClick={onDouble}>
        {toolbar}
        <div className="flex flex-col items-center">
          <svg width="48" height="34" viewBox="0 0 48 34">
            {data.gateType === 'AND'
              ? <path d="M4 32 V14 a20 20 0 0 1 40 0 V32 Z" fill="#fff" stroke={color} strokeWidth="2" />
              : <path d="M4 32 q20 -10 40 0 q-6 -26 -20 -30 q-14 4 -20 30 Z" fill="#fff" stroke={color} strokeWidth="2" />}
          </svg>
          <span className="-mt-1 rounded bg-ink-900 px-1.5 text-[9px] font-black text-white">{data.gateType || 'AND'}</span>
          <div className="mt-0.5 w-[92px]">{label}</div>
        </div>
        {handles}
      </div>
    )
  }

  // box / root
  const isRoot = data.kind === 'root'
  return (
    <div
      className={`${common} min-h-[40px] w-[150px] rounded-xl px-2 py-2 shadow-sm`}
      style={{
        background: isRoot ? color : '#fff',
        color: isRoot ? '#fff' : '#1c2230',
        border: `2px solid ${color}`,
        boxShadow: selected ? `0 0 0 3px ${color}40` : undefined,
      }}
      onDoubleClick={onDouble}
    >
      {toolbar}{label}{handles}
    </div>
  )
}
