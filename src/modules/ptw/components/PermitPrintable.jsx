import { forwardRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { statusMeta } from '../lib/permitStatus'
import { publicPermitUrl } from '../lib/qr'

const fmt = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function decisionLine(label, block) {
  if (!block) return `${label}: —`
  const s = block.status === 'approved' ? 'Approved' : block.status === 'rejected' ? 'Rejected' : 'Pending'
  return `${label}: ${s}${block.byName ? ` by ${block.byName}` : ''}${block.at ? ` (${fmt(block.at)})` : ''}`
}

/** Repeated diagonal status watermark in the status color. */
function Watermark({ label, color }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        transform: 'rotate(-30deg)',
        opacity: 0.1,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            whiteSpace: 'nowrap',
            fontSize: '46px',
            fontWeight: 900,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color,
            lineHeight: 1.9,
          }}
        >
          {`${label}   ${label}   ${label}`}
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ position: 'relative', zIndex: 1, marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', borderBottom: '1px solid #e5e7eb', paddingBottom: 4, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
      <span style={{ width: 150, color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 600 }}>{value || '—'}</span>
    </div>
  )
}

function Tags({ items }) {
  if (!items?.length) return <span style={{ fontSize: 12, color: '#9ca3af' }}>None</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((t) => (
        <span key={t} style={{ fontSize: 11, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 8px', color: '#374151' }}>{t}</span>
      ))}
    </div>
  )
}

/** Full A4 printable permit document. Used by react-to-print on the detail page. */
const PermitPrintable = forwardRef(function PermitPrintable({ permit, documents = [] }, ref) {
  if (!permit) return <div ref={ref} />
  const meta = statusMeta(permit.status)

  return (
    <div ref={ref} className="print-area" style={{ position: 'relative', background: '#fff', color: '#111827', padding: 28, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Watermark label={meta.label} color={meta.color} />

      {/* Header */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `3px solid ${meta.color}`, paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#111827' }}>Permit to Work</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{permit.permitNo}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ display: 'inline-block', background: meta.color, color: '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800 }}>{meta.label}</span>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Printed {fmt(new Date().toISOString())}</div>
          </div>
          {permit.qrToken && (
            <div style={{ background: '#fff', padding: 4, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <QRCodeCanvas value={publicPermitUrl(permit.qrToken)} size={72} level="M" />
            </div>
          )}
        </div>
      </div>

      <Section title="Work details">
        <Row label="Type of work" value={permit.typeOfWork} />
        {permit.site ? <Row label="Site" value={permit.site} /> : null}
        <Row label="Date / start time" value={`${permit.date || '—'}  ${permit.time || ''}`} />
        <Row label="Valid from" value={fmt(permit.validFrom)} />
        <Row label="Valid to" value={fmt(permit.validTo)} />
        <Row label="Job location" value={permit.jobLocation} />
        <Row label="Issuing department" value={permit.issuingDepartment} />
        <Row label="Issued to" value={`${permit.issuedToName || '—'}${permit.issuedToPhone ? ` · ${permit.issuedToPhone}` : ''}`} />
        <Row label="Job description" value={permit.jobDescription} />
        <Row label="Raised by" value={permit.createdByName} />
      </Section>

      <Section title="Hazard identification"><Tags items={permit.hazards} /></Section>

      {permit.jsa?.length > 0 && (
        <Section title="Job Safety Analysis">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px', border: '1px solid #e5e7eb', width: '33%' }}>Activity step</th>
                <th style={{ padding: '4px 6px', border: '1px solid #e5e7eb', width: '33%' }}>Hazard</th>
                <th style={{ padding: '4px 6px', border: '1px solid #e5e7eb' }}>Precaution</th>
              </tr>
            </thead>
            <tbody>
              {permit.jsa.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '4px 6px', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>{r.step || '—'}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>{r.hazard || '—'}</td>
                  <td style={{ padding: '4px 6px', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>{r.precaution || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="PPE required"><Tags items={permit.ppe} /></Section>
      <Section title="Precautions"><Tags items={permit.precautions} /></Section>

      <Section title="Participants">
        {permit.participants?.length ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {permit.participants.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: '#111827' }}>
                <strong>{p.name}</strong> <span style={{ color: '#6b7280' }}>({p.type})</span>
                {p.company ? ` · ${p.company}` : ''}{p.contact ? ` · ${p.contact}` : ''}
              </div>
            ))}
          </div>
        ) : <span style={{ fontSize: 12, color: '#9ca3af' }}>None</span>}
      </Section>

      {permit.fireWatchers?.length > 0 && (
        <Section title="Fire watcher(s)">
          {permit.fireWatchers.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: '#111827' }}><strong>{w.name}</strong>{w.details ? ` · ${w.details}` : ''}</div>
          ))}
        </Section>
      )}

      {permit.confinedWatcher?.name && (
        <Section title="Standby watcher / attendant">
          <div style={{ fontSize: 12, color: '#111827' }}><strong>{permit.confinedWatcher.name}</strong>{permit.confinedWatcher.details ? ` · ${permit.confinedWatcher.details}` : ''}</div>
        </Section>
      )}

      {(permit.requiredDocs?.length > 0 || documents.length > 0) && (
        <Section title="Documents">
          {permit.requiredDocs?.map((req) => {
            const attached = documents.some((d) => d.key === req.key)
            return (
              <div key={req.key} style={{ fontSize: 12, color: '#111827', padding: '1px 0' }}>
                {attached ? '☑' : '☐'} {req.label}{req.mandatory ? ' (mandatory)' : ''}{attached ? '' : ' — not attached'}
              </div>
            )
          })}
          {documents.filter((d) => d.key === 'extra').map((d) => (
            <div key={d.id} style={{ fontSize: 12, color: '#111827', padding: '1px 0' }}>☑ {d.fileName} (other)</div>
          ))}
        </Section>
      )}

      <Section title="Approvals">
        <Row label="Engineering" value={decisionLine('', permit.engineering).replace(': ', '')} />
        <Row label="Operations" value={decisionLine('', permit.operations).replace(': ', '')} />
        {permit.assignedEngineer && <Row label="Assigned engineer" value="Specific approver assigned" />}
        {permit.assignedOperator && <Row label="Assigned operator" value="Specific approver assigned" />}
      </Section>

      {permit.extension && (
        <Section title="Extension">
          <Row label="Reason" value={permit.extension.reason} />
          <Row label="New valid to" value={fmt(permit.extension.newValidTo)} />
          <Row label="Participant changes" value={permit.extension.participantChanges} />
          <Row label="Risk changes" value={permit.extension.riskChanges} />
          <Row label="Engineering" value={decisionLine('', permit.extension.engineering).replace(': ', '')} />
          <Row label="Operations" value={decisionLine('', permit.extension.operations).replace(': ', '')} />
        </Section>
      )}

      {permit.closure && (
        <Section title="Closure">
          <Row label="Requested by" value={`${permit.closure.requestedByName || '—'} (${fmt(permit.closure.requestedAt)})`} />
          <Row label="Engineering" value={decisionLine('', permit.closure.engineering).replace(': ', '')} />
          <Row label="Operations" value={decisionLine('', permit.closure.operations).replace(': ', '')} />
        </Section>
      )}

      <div style={{ position: 'relative', zIndex: 1, marginTop: 28, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
        {['Issuer', 'Engineering', 'Operations'].map((sig) => (
          <div key={sig} style={{ flex: 1, borderTop: '1px solid #9ca3af', paddingTop: 6, fontSize: 11, color: '#6b7280' }}>{sig} sign &amp; date</div>
        ))}
      </div>
    </div>
  )
})

export default PermitPrintable
