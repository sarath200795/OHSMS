import { Download, Cctv, HardDrive, Router, CircleCheck } from 'lucide-react'
import { PageHeader, Button, EmptyState, SkeletonTable, Pager } from '../../../shared/ui'
import { usePagination } from '../../../shared/ui/usePagination'
import { useCctv } from '../context/CctvContext'
import { downloadDefects } from '../lib/exporter'
import { CAMERA_DEFECT_BY_KEY, DVR_DEFECT_BY_KEY, MERAKI_DEFECT_BY_KEY, CAUSE_LABEL, CAUSE } from '../lib/constants'
import { DefectChips } from '../components/ui'

/**
 * Defects, one section per device kind.
 *
 * Deliberately three lists rather than one merged table. Merged, a single dead
 * switch fills the page with cameras and the actual fault scrolls off the top —
 * and whoever works the list raises a job per camera. Kept apart, the same
 * outage is one Meraki row, and the camera list stays a list of broken cameras.
 */
export default function Defects() {
  const { estate, orgName, loading, cameras, dvrs, merakis } = useCctv()
  const { defects, cameraSummary: cs } = estate
  const total = defects.camera.length + defects.dvr.length + defects.meraki.length
  const nothingInstalled = !cameras.length && !dvrs.length && !merakis.length

  if (loading) {
    return (<><PageHeader title="CCTV Defects" /><SkeletonTable rows={6} /></>)
  }

  return (
    <>
      <PageHeader
        title="CCTV Defects"
        subtitle={total ? `${total} device${total === 1 ? '' : 's'} needing attention` : 'Nothing outstanding'}
        actions={
          <Button variant="ghost" icon={Download} disabled={nothingInstalled}
            onClick={() => downloadDefects(estate, { orgName })}>
            Export defects
          </Button>
        }
      />

      {/* The number that stops this page being misread. */}
      {cs.byCause[CAUSE.DVR] + cs.byCause[CAUSE.MERAKI] > 0 && (
        <div className="card mb-4 p-4 text-sm text-ink-600">
          <b>{cs.byCause[CAUSE.DVR] + cs.byCause[CAUSE.MERAKI]}</b> camera
          {cs.byCause[CAUSE.DVR] + cs.byCause[CAUSE.MERAKI] === 1 ? ' is' : 's are'} dark because a DVR or Meraki
          above {cs.byCause[CAUSE.DVR] + cs.byCause[CAUSE.MERAKI] === 1 ? 'it' : 'them'} is down. Those cameras are
          not listed as camera defects — fixing the device below will bring them all back.
        </div>
      )}

      {total === 0 && !nothingInstalled && (
        <EmptyState icon={CircleCheck} title="No defects" hint="Every camera, DVR and Meraki device is reporting healthy." />
      )}

      <Section
        icon={Cctv}
        title="Camera defects"
        hint="Cameras that are themselves faulty, or streaming but unusable."
        rows={defects.camera}
        table={CAMERA_DEFECT_BY_KEY}
        columns={[
          { head: 'Camera', cell: (d) => d.name, strong: true },
          { head: 'Location', cell: (d) => d.location || '—' },
          { head: 'Site', cell: (d) => d.siteName || '—' },
          { head: 'DVR', cell: (d) => d.dvrName || '—' },
        ]}
      />

      <Section
        icon={HardDrive}
        title="DVR defects"
        hint="A DVR listed here takes every camera on it down with it."
        rows={defects.dvr}
        table={DVR_DEFECT_BY_KEY}
        columns={[
          { head: 'DVR', cell: (d) => d.name, strong: true },
          { head: 'IP address', cell: (d) => d.ipAddress || '—', mono: true },
          { head: 'Site', cell: (d) => d.siteName || '—' },
        ]}
      />

      <Section
        icon={Router}
        title="Meraki defects"
        hint="A Meraki listed here darkens every DVR and camera at its site."
        rows={defects.meraki}
        table={MERAKI_DEFECT_BY_KEY}
        columns={[
          { head: 'Device', cell: (d) => d.name, strong: true },
          { head: 'IP address', cell: (d) => d.ipAddress || '—', mono: true },
          { head: 'Site', cell: (d) => d.siteName || '—' },
        ]}
      />
    </>
  )
}

/**
 * Each section paginates independently.
 *
 * One shared page number across three lists would mean paging through camera
 * defects silently blanked the DVR and Meraki sections — and those are the two
 * a reader most needs to see, because a device listed there is why the cameras
 * are dark.
 */
function Section({ icon: Icon, title, hint, rows, table, columns }) {
  const { pageItems, page, setPage, pageCount, total, pageSize } = usePagination(rows)
  return (
    <section className="mt-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink-800">
        <Icon size={15} /> {title}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">{rows.length}</span>
      </h2>
      <p className="mb-2 text-xs text-ink-500">{hint}</p>
      {!rows.length ? (
        <div className="card px-4 py-3 text-sm text-ink-400">None.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-ink-50/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                {columns.map((c) => <th key={c.head} className="px-3 py-2">{c.head}</th>)}
                <th className="px-3 py-2">Defects</th>
                <th className="px-3 py-2">Fault</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((d) => (
                <tr key={d.id} className="border-t border-ink-100">
                  {columns.map((c) => (
                    <td
                      key={c.head}
                      className={`px-3 py-2 ${c.strong ? 'font-medium text-ink-800' : ''} ${c.mono ? 'font-mono text-xs' : ''}`}
                    >
                      {c.cell(d)}
                    </td>
                  ))}
                  <td className="px-3 py-2"><DefectChips keys={d.defects} table={table} /></td>
                  <td className="px-3 py-2 text-xs text-ink-500">{CAUSE_LABEL[d.cause] || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            className="border-t border-ink-100 px-3 py-2"
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            total={total}
            pageSize={pageSize}
          />
        </div>
      )}
    </section>
  )
}
