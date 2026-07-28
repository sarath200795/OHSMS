import { EMERGENCY_TEAMS, getFireSourceLabel, getMedicalIncidentLabel } from '../lib/mockDrillTemplates'

// Print-only formatted report for a single mock-drill / emergency record.
// Rendered off-screen in MockDrills.jsx and captured by react-to-print.
// Plain black-on-white so it reads as a compliance document.
export default function MockDrillReport({ record }) {
  if (!record) return null
  const r = record
  const checklist = r.checklist || []
  const teamsAlerted = r.teamsAlerted || {}
  const checklistStatus = r.checklistStatus || {}

  return (
    <div className="bg-white p-8 text-black" style={{ width: '210mm', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div className="mb-6 flex items-end justify-between border-b-4 border-black pb-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-gray-500">
            🔥 Fire Marshal — Emergency Records
          </div>
          <h1 className="m-0 text-3xl font-black uppercase leading-none tracking-tight">
            {r.eventType || 'Mock Drill'} Report
          </h1>
        </div>
        <div className="text-right text-sm">
          <p className="font-mono font-bold">ID: {r.docId || '—'}</p>
          <p className="mt-1 font-bold uppercase">Date: {r.date || '—'}</p>
        </div>
      </div>

      {/* Summary */}
      <table className="mb-6 w-full border border-black text-sm">
        <tbody>
          <tr>
            <td className="w-[18%] border-b border-gray-300 py-1.5 px-2 font-bold">Scenario</td>
            <td className="border-b border-gray-300 py-1.5 px-2 text-base font-bold" colSpan={3}>{r.scenario}</td>
          </tr>
          <tr>
            <td className="border-b border-gray-300 py-1.5 px-2 font-bold">Site / Location</td>
            <td className="w-[32%] border-b border-gray-300 py-1.5 px-2">{r.centerName || '—'}</td>
            <td className="w-[18%] border-b border-gray-300 py-1.5 px-2 font-bold">Time</td>
            <td className="border-b border-gray-300 py-1.5 px-2 font-mono">{r.time || '—'}</td>
          </tr>
          <tr>
            <td className="border-b border-gray-300 py-1.5 px-2 font-bold">Region</td>
            <td className="border-b border-gray-300 py-1.5 px-2">{r.region || '—'}</td>
            <td className="border-b border-gray-300 py-1.5 px-2 font-bold">Commander(s)</td>
            <td className="border-b border-gray-300 py-1.5 px-2 font-bold">{r.commander || '—'}</td>
          </tr>
          {r.fireSource && (
            <tr>
              <td className="py-1.5 px-2 font-bold">Fire Source</td>
              <td className="py-1.5 px-2" colSpan={3}>{getFireSourceLabel(r.fireSource)}</td>
            </tr>
          )}
          {r.medicalIncidentType && (
            <tr>
              <td className="py-1.5 px-2 font-bold">Medical Incident</td>
              <td className="py-1.5 px-2" colSpan={3}>{getMedicalIncidentLabel(r.medicalIncidentType)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Metrics */}
      <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">1. Execution Metrics</h2>
      <table className="mb-6 w-full border-collapse border border-black text-sm">
        <tbody>
          <tr>
            <td className="w-[20%] border border-black bg-gray-100 p-2 font-bold">Evacuation Time</td>
            <td className="border border-black p-2 font-mono">{r.evacTimeMin ? `${r.evacTimeMin} min` : '—'}</td>
            <td className="w-[20%] border border-black bg-gray-100 p-2 font-bold">ERT Response</td>
            <td className="border border-black p-2 font-mono">{r.ertResponseMin ? `${r.ertResponseMin} min` : '—'}</td>
          </tr>
          <tr>
            <td className="border border-black bg-gray-100 p-2 font-bold">Head Count</td>
            <td className="border border-black p-2 font-mono">{r.headCount ?? '—'}</td>
            <td className="border border-black bg-gray-100 p-2 font-bold">Outcome</td>
            <td className="border border-black p-2 font-bold">{r.outcome || '—'}</td>
          </tr>
        </tbody>
      </table>

      {/* Teams */}
      <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">2. Teams Activated</h2>
      <table className="mb-6 w-full text-sm">
        <tbody>
          {[0, 4].map((start) => (
            <tr key={start}>
              {EMERGENCY_TEAMS.slice(start, start + 4).map((t, i) => (
                <td key={t} className="w-[25%] p-1.5">
                  <span className="mr-2 text-base font-bold">{teamsAlerted[start + i] ? '☑' : '☐'}</span>
                  {t}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Checklist */}
      <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">
        3. {r.scenario === 'Medical Emergency' ? 'Medical Examination & Response' : 'Procedural Execution'} Checklist
      </h2>
      <table className="mb-6 w-full border-collapse border border-black text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="w-[15%] border border-black p-2 text-center">Status</th>
            <th className="border border-black p-2 text-left">Protocol Item</th>
          </tr>
        </thead>
        <tbody>
          {checklist.length > 0 ? (
            checklist.map((item, idx) => (
              <tr key={idx}>
                <td className="border border-black p-2 text-center font-mono font-bold">
                  {checklistStatus[idx] ? 'PASS' : 'FAIL'}
                </td>
                <td className="border border-black p-2">{item}</td>
              </tr>
            ))
          ) : (
            <tr><td className="border border-black p-3 italic" colSpan={2}>No checklist data.</td></tr>
          )}
          <tr>
            <td className="border border-black bg-gray-100 p-2 text-right font-bold" colSpan={2}>
              Overall Protocol Score: {r.score ?? 0}%
            </td>
          </tr>
        </tbody>
      </table>

      {/* Action log */}
      <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">4. Chronological Action Log</h2>
      <table className="mb-6 w-full border-collapse border border-black text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="w-[15%] border border-black p-2 text-left">Time</th>
            <th className="w-[40%] border border-black p-2 text-left">Action Taken</th>
            <th className="border border-black p-2 text-left">Observation</th>
          </tr>
        </thead>
        <tbody>
          {(r.actionLog || []).length > 0 ? (
            r.actionLog.map((row, i) => (
              <tr key={i}>
                <td className="border border-black p-2 font-mono">{row.time || '—'}</td>
                <td className="border border-black p-2 font-bold">{row.action}</td>
                <td className="border border-black p-2">{row.observation}</td>
              </tr>
            ))
          ) : (
            <tr><td className="border border-black p-3 text-center italic" colSpan={3}>No action logs recorded.</td></tr>
          )}
        </tbody>
      </table>

      {/* Debrief & CAPA */}
      <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">5. Debrief & CAPA Plan</h2>
      <div className="mb-4 border border-black bg-gray-50 p-3 text-sm">
        <strong>Debrief Notes:</strong>
        <div className="mt-1 whitespace-pre-wrap">{r.debrief || 'None recorded.'}</div>
      </div>
      <table className="mb-10 w-full border-collapse border border-black text-sm">
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-black p-2 text-left">Action Required (CAPA)</th>
            <th className="w-[22%] border border-black p-2 text-left">Owner</th>
            <th className="w-[15%] border border-black p-2 text-center">Due</th>
            <th className="w-[14%] border border-black p-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {(r.capa || []).length > 0 ? (
            r.capa.map((c, i) => (
              <tr key={i}>
                <td className="border border-black p-2">{c.action}</td>
                <td className="border border-black p-2 font-bold">{c.owner || '—'}</td>
                <td className="border border-black p-2 text-center font-mono">{c.due || '—'}</td>
                <td className="border border-black p-2 text-center">{c.status || 'Open'}</td>
              </tr>
            ))
          ) : (
            <tr><td className="border border-black p-3 text-center italic" colSpan={4}>No CAPA items required.</td></tr>
          )}
        </tbody>
      </table>

      {/* Evidence photos */}
      {Array.isArray(r.photos) && r.photos.length > 0 && (
        <div className="mb-6 page-break-inside-avoid">
          <h2 className="mb-2 inline-block border border-gray-400 bg-gray-200 px-1 text-sm font-bold uppercase">6. Evidence Photos</h2>
          <div className="flex flex-wrap gap-3">
            {r.photos.map((src, i) => (
              <img key={i} src={src} alt={`Evidence ${i + 1}`} className="rounded border border-gray-400 object-contain" style={{ height: '46mm', maxWidth: '31%' }} />
            ))}
          </div>
        </div>
      )}

      {/* Signatures */}
      <table className="mt-16 w-full text-sm">
        <tbody>
          <tr>
            <td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">
              Incident Commander Signature
            </td>
            <td className="w-[10%]" />
            <td className="w-[45%] border-t-2 border-black pt-2 text-center font-bold uppercase tracking-widest">
              EHS Manager Signature
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-8 border-t border-gray-300 pt-3 text-center font-mono text-xs text-gray-500">
        Generated by Fire Marshal · Logged by {r.loggedBy || '—'}
      </div>
    </div>
  )
}
