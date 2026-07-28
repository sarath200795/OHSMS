import ModulePage from '../../shared/module-kit/ModulePage'
import { createModuleService } from '../../shared/module-kit/service'
import { MODULE_BY_KEY } from '../../shared/modules/registry'
import { Badge } from '../../shared/ui'
import { formatDate, isOverdue } from '../../shared/lib/format'

const module = MODULE_BY_KEY.documents

const TYPE_TONE = { Policy: 'brand', SOP: 'blue', SDS: 'amber', Form: 'gray' }

const config = {
  singular: 'Document',
  plural: 'Documents',
  subtitle: 'Versioned policies, SOPs, forms and Safety Data Sheets (SDS)',
  titleField: 'title',
  service: createModuleService('documents', 'documents'),
  defaultStatus: 'draft',
  statuses: [
    { value: 'draft', label: 'Draft', tone: 'gray' },
    { value: 'active', label: 'Active', tone: 'green' },
    { value: 'under_review', label: 'Under review', tone: 'amber' },
    { value: 'archived', label: 'Archived', tone: 'gray' },
  ],
  columns: [
    { key: 'title', label: 'Document' },
    { key: 'docType', label: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.docType] || 'gray'}>{r.docType || '—'}</Badge> },
    { key: 'version', label: 'Ver.' },
    { key: 'reviewDate', label: 'Review due', render: (r) => (
      <span className={isOverdue(r.reviewDate) ? 'font-semibold text-red-600' : ''}>{formatDate(r.reviewDate)}</span>
    ) },
  ],
  fields: [
    { key: 'title', label: 'Document title', full: true, required: true },
    { key: 'docType', label: 'Type', type: 'select', required: true, options: ['Policy', 'SOP', 'SDS', 'Form'] },
    { key: 'version', label: 'Version', placeholder: 'e.g. 1.0' },
    { key: 'owner', label: 'Owner' },
    { key: 'reference', label: 'Reference no.' },
    { key: 'effectiveDate', label: 'Effective date', type: 'date' },
    { key: 'reviewDate', label: 'Next review date', type: 'date', hint: 'Overdue reviews are flagged' },
    { key: 'summary', label: 'Summary / notes', type: 'textarea', full: true, rows: 3 },
  ],
}

export default function DocumentsModule() {
  return <ModulePage module={module} config={config} />
}
