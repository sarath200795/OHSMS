import { BarChart3, Download } from 'lucide-react'
import { Button, PageHeader } from '../ui'
import { MODULE_BY_KEY } from '../modules/registry'

/**
 * Chrome for a module-owned reports page: title, optional CSV, children.
 *
 * Each module's Reports.jsx imports only its own charts / stats. This wrapper
 * must not import analytics tabs — a central mapper would pull every module's
 * dashboard into every module bundle.
 */
export default function ModuleReportsPage({
  moduleKey,
  subtitle,
  onExport,
  exportLabel = 'Download CSV',
  exporting = false,
  children,
}) {
  const mod = MODULE_BY_KEY[moduleKey]
  return (
    <div>
      <PageHeader
        title={`${mod.label} reports`}
        subtitle={subtitle}
        icon={BarChart3}
        actions={
          onExport ? (
            <Button icon={Download} loading={exporting} onClick={onExport}>
              {exportLabel}
            </Button>
          ) : null
        }
      />
      {children}
    </div>
  )
}
