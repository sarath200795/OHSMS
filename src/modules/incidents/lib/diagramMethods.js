// ─────────────────────────────────────────────────────────────────────────────
// Investigation-method registry. Each method defines its starting template,
// toolbar actions (append nodes/edges), connection validity, optional edge
// decoration, and a validate() check. The generic <DiagramCanvas> consumes this
// so adding a method later is one entry. All nodes use the single 'ira' node type
// (EditableNode); behaviour comes from node.data.
// ─────────────────────────────────────────────────────────────────────────────

const rid = () => (crypto?.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10))
const nid = () => `n_${rid()}`

const N = (id, label, kind, flow, color, position, extra = {}) => ({
  id, type: 'ira', position, data: { label, kind, flow, color, ...extra },
})
const E = (source, target, extra = {}) => ({ id: `e_${rid()}`, source, target, ...extra })

const short = (s, n = 60) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : '')

// Lowest node in a vertical chain (used to append the next "why" / gate input).
const lastVertical = (nodes) => nodes.reduce((a, b) => (b.position.y > (a?.position.y ?? -Infinity) ? b : a), null)

// Cycle check for FTA: would adding source→target create a cycle?
function wouldCycle(edges, source, target) {
  if (source === target) return true
  const adj = {}
  for (const e of edges) (adj[e.source] ||= []).push(e.target)
  const stack = [target]
  const seen = new Set()
  while (stack.length) {
    const cur = stack.pop()
    if (cur === source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const nx of adj[cur] || []) stack.push(nx)
  }
  return false
}

export const METHODS = {
  '5why': {
    flow: 'vertical',
    makeTemplate(incident) {
      const problem = N('problem', `Problem: ${short(incident?.narrative) || '…'}`, 'root', 'vertical', '#dc2626', { x: 260, y: 0 })
      const why1 = N(nid(), 'Why did this happen?', 'box', 'vertical', '#795548', { x: 260, y: 130 })
      return { nodes: [problem, why1], edges: [E(problem.id, why1.id)] }
    },
    toolbar: [
      // "Add Why" extends the chain from the SELECTED node (or the lowest node if
      // none is selected). Adding a second child to a node forks a new path — so
      // you can build multiple parallel "why" branches from any point.
      { label: 'Add Why', run({ nodes, edges, selected }) {
        const parent = selected || lastVertical(nodes)
        const siblings = edges.filter((e) => e.source === parent?.id).length
        const node = N(nid(), 'Why?', 'box', 'vertical', '#795548', {
          x: (parent?.position.x ?? 260) + siblings * 190,
          y: (parent?.position.y ?? 0) + 130,
        })
        return { nodes: [node], edges: parent ? [E(parent.id, node.id)] : [] }
      } },
      { label: 'Add Branch', run({ nodes, edges, selected }) {
        // Force a new parallel path: a fresh Why off the selected node (or root),
        // always offset sideways from existing children.
        const parent = selected || nodes.find((n) => n.id === 'problem') || lastVertical(nodes)
        const siblings = edges.filter((e) => e.source === parent?.id).length
        const node = N(nid(), 'Why? (new path)', 'box', 'vertical', '#8b5cf6', {
          x: (parent?.position.x ?? 260) + (siblings + 1) * 190,
          y: (parent?.position.y ?? 0) + 130,
        })
        return { nodes: [node], edges: parent ? [E(parent.id, node.id)] : [] }
      } },
      { label: 'Add Root Cause', run({ nodes, edges, selected }) {
        const parent = selected || lastVertical(nodes)
        const siblings = edges.filter((e) => e.source === parent?.id).length
        const node = N(nid(), 'Root cause', 'root', 'vertical', '#16a34a', {
          x: (parent?.position.x ?? 260) + siblings * 190,
          y: (parent?.position.y ?? 0) + 130,
        })
        return { nodes: [node], edges: parent ? [E(parent.id, node.id)] : [] }
      } },
    ],
    validate(nodes) {
      return nodes.length >= 4
        ? { ok: true }
        : { ok: false, message: 'Add at least 3 “why” levels to reach a credible root cause.' }
    },
  },

  fishbone: {
    flow: 'horizontal',
    makeTemplate(incident) {
      const effect = N('effect', `Effect: ${short(incident?.narrative, 40) || '…'}`, 'diamond', 'horizontal', '#dc2626', { x: 720, y: 190 })
      const cats = ['Man', 'Machine', 'Method', 'Material', 'Measurement', 'Environment']
      const pos = [[120, 30], [360, 30], [560, 30], [120, 360], [360, 360], [560, 360]]
      const catNodes = cats.map((c, i) => N(`cat_${c.toLowerCase()}`, c, 'box', 'horizontal', '#795548', { x: pos[i][0], y: pos[i][1] }))
      const edges = catNodes.map((c) => E(c.id, effect.id))
      return { nodes: [effect, ...catNodes], edges }
    },
    toolbar: [
      { label: 'Add Cause', run({ nodes }) {
        const count = nodes.filter((n) => n.id.startsWith('n_')).length
        const node = N(nid(), 'Cause', 'box', 'horizontal', '#0891b2', { x: 40 + (count % 3) * 60, y: 130 + (count % 4) * 30 })
        return { nodes: [node], edges: [] }
      } },
    ],
    validate(nodes) {
      const causes = nodes.filter((n) => n.id.startsWith('n_'))
      return causes.length >= 1 ? { ok: true } : { ok: false, message: 'Add at least one cause and connect it to a 6M category.' }
    },
  },

  bowtie: {
    flow: 'horizontal',
    makeTemplate() {
      const top = N('top', 'Top Event', 'diamond', 'horizontal', '#dc2626', { x: 470, y: 200 }, { col: 3 })
      const threat = N(nid(), 'Threat', 'box', 'horizontal', '#f59e0b', { x: 40, y: 120 }, { col: 1 })
      const cons = N(nid(), 'Consequence', 'box', 'horizontal', '#ef4444', { x: 880, y: 120 }, { col: 5 })
      return { nodes: [top, threat, cons], edges: [E(threat.id, top.id), E(top.id, cons.id)] }
    },
    toolbar: [
      { label: 'Add Threat', run({ nodes }) { const c = nodes.filter((n) => n.data.col === 1).length; return { nodes: [N(nid(), 'Threat', 'box', 'horizontal', '#f59e0b', { x: 40, y: 40 + c * 90 }, { col: 1 })], edges: [] } } },
      { label: 'Preventive Barrier', run({ nodes }) { const c = nodes.filter((n) => n.data.col === 2).length; return { nodes: [N(nid(), 'Preventive barrier', 'box', 'horizontal', '#14b8a6', { x: 260, y: 40 + c * 90 }, { col: 2 })], edges: [] } } },
      { label: 'Mitigative Barrier', run({ nodes }) { const c = nodes.filter((n) => n.data.col === 4).length; return { nodes: [N(nid(), 'Mitigative barrier', 'box', 'horizontal', '#0891b2', { x: 670, y: 40 + c * 90 }, { col: 4 })], edges: [] } } },
      { label: 'Add Consequence', run({ nodes }) { const c = nodes.filter((n) => n.data.col === 5).length; return { nodes: [N(nid(), 'Consequence', 'box', 'horizontal', '#ef4444', { x: 880, y: 40 + c * 90 }, { col: 5 })], edges: [] } } },
    ],
    isValidConnection(conn, nodes) {
      const s = nodes.find((n) => n.id === conn.source)
      const t = nodes.find((n) => n.id === conn.target)
      if (!s || !t) return true
      return (s.data.col ?? 0) <= (t.data.col ?? 99) // left-to-right only
    },
    validate(nodes) {
      const hasThreat = nodes.some((n) => n.data.col === 1)
      const hasCons = nodes.some((n) => n.data.col === 5)
      return hasThreat && hasCons ? { ok: true } : { ok: false, message: 'A bow-tie needs at least one threat and one consequence.' }
    },
  },

  fta: {
    flow: 'vertical',
    makeTemplate() {
      const top = N('top', 'Top Event', 'box', 'vertical', '#dc2626', { x: 300, y: 0 })
      const gate = N(nid(), 'Gate', 'gate', 'vertical', '#795548', { x: 300, y: 130 }, { gateType: 'OR' })
      return { nodes: [top, gate], edges: [E(top.id, gate.id)] }
    },
    toolbar: [
      { label: 'AND Gate', run({ nodes }) { return { nodes: [N(nid(), 'Gate', 'gate', 'vertical', '#795548', { x: 120 + nodes.length * 20, y: 260 }, { gateType: 'AND' })], edges: [] } } },
      { label: 'OR Gate', run({ nodes }) { return { nodes: [N(nid(), 'Gate', 'gate', 'vertical', '#795548', { x: 120 + nodes.length * 20, y: 260 }, { gateType: 'OR' })], edges: [] } } },
      { label: 'Basic Event', run({ nodes }) { return { nodes: [N(nid(), 'Basic event', 'circle', 'vertical', '#16a34a', { x: 120 + nodes.length * 20, y: 400 })], edges: [] } } },
      { label: 'Intermediate', run({ nodes }) { return { nodes: [N(nid(), 'Intermediate event', 'box', 'vertical', '#f59e0b', { x: 120 + nodes.length * 20, y: 400 })], edges: [] } } },
    ],
    isValidConnection(conn, nodes, edges) {
      return !wouldCycle(edges || [], conn.source, conn.target)
    },
    validate(nodes, edges) {
      // Each gate must have ≥2 inputs.
      const gates = nodes.filter((n) => n.data.kind === 'gate')
      for (const g of gates) {
        const inputs = edges.filter((e) => e.target === g.id).length
        if (inputs < 2) return { ok: false, message: 'Each logic gate needs at least 2 inputs.' }
      }
      return { ok: true }
    },
  },

  eta: {
    flow: 'horizontal',
    makeTemplate() {
      const init = N('init', 'Initiating Event', 'box', 'horizontal', '#dc2626', { x: 40, y: 220 })
      return { nodes: [init], edges: [] }
    },
    toolbar: [
      { label: 'Add Pivot', run({ nodes }) { const c = nodes.filter((n) => n.data.kind === 'diamond').length; return { nodes: [N(nid(), 'Pivotal event', 'diamond', 'horizontal', '#795548', { x: 260 + c * 220, y: 200 })], edges: [] } } },
      { label: 'Add Outcome', run({ nodes }) { const c = nodes.filter((n) => n.data.outcome).length; return { nodes: [N(nid(), 'Outcome', 'box', 'horizontal', '#16a34a', { x: 760, y: 60 + c * 110 }, { outcome: true })], edges: [] } } },
    ],
    // Branches from a pivot alternate Success (green) / Failure (red).
    decorateEdge(conn, nodes, edges) {
      const src = nodes.find((n) => n.id === conn.source)
      if (src?.data.kind !== 'diamond') return {}
      const out = edges.filter((e) => e.source === conn.source).length
      return out % 2 === 0
        ? { label: 'Success', style: { stroke: '#16a34a' }, labelStyle: { fill: '#16a34a', fontWeight: 700 } }
        : { label: 'Failure', style: { stroke: '#dc2626' }, labelStyle: { fill: '#dc2626', fontWeight: 700 } }
    },
    validate(nodes) {
      return nodes.some((n) => n.data.outcome) ? { ok: true } : { ok: false, message: 'Add at least one outcome node.' }
    },
  },
}

export const methodKeys = Object.keys(METHODS)
