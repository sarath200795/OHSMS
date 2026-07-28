import { useCallback, useEffect } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus } from 'lucide-react'
import EditableNode from './EditableNode'
import { METHODS } from '../../lib/diagramMethods'

const nodeTypes = { ira: EditableNode }

function Canvas({ method, initial, onChange, flowRef }) {
  const cfg = METHODS[method]
  const [nodes, setNodes, onNodesChange] = useNodesState(initial?.nodes || [])
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial?.edges || [])

  // Bubble changes up so the wizard can persist on Save.
  useEffect(() => { onChange?.({ nodes, edges }) }, [nodes, edges, onChange])

  const onConnect = useCallback((conn) => {
    if (cfg.isValidConnection && !cfg.isValidConnection(conn, nodes, edges)) return
    const deco = cfg.decorateEdge ? cfg.decorateEdge(conn, nodes, edges) : {}
    setEdges((eds) => addEdge({ ...conn, markerEnd: { type: MarkerType.ArrowClosed }, ...deco }, eds))
  }, [cfg, nodes, edges, setEdges])

  const isValidConnection = useCallback(
    (conn) => (cfg.isValidConnection ? cfg.isValidConnection(conn, nodes, edges) : true),
    [cfg, nodes, edges]
  )

  const runTool = (item) => {
    const selected = nodes.find((n) => n.selected) || null
    const out = item.run({ nodes, edges, selected })
    if (out.nodes?.length) setNodes((n) => [...n.map((x) => ({ ...x, selected: false })), ...out.nodes])
    if (out.edges?.length) setEdges((e) => [...e, ...out.edges])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {cfg.toolbar.map((item) => (
          <button key={item.label} type="button" className="btn-soft px-3 py-1.5 text-xs" onClick={() => runTool(item)}>
            <Plus size={13} /> {item.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-ink-400">Tip: click a node to select it, then “Add…” to branch from it · double-click to rename · Del to remove · drag handles to connect</span>
      </div>

      <div ref={flowRef} className="h-[520px] overflow-hidden rounded-2xl border border-clay-300 bg-white shadow-clay-inset">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
        >
          <Background color="#cbd5e1" gap={18} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => n.data?.color || '#795548'} />
        </ReactFlow>
      </div>
    </div>
  )
}

/** Generic interactive diagram builder driven by the method registry. */
export default function DiagramCanvas(props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
