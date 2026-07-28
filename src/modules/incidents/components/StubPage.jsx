import { PageHeader, EmptyState } from './ui'

/** Temporary placeholder for pages built in a later phase. */
export default function StubPage({ title, subtitle, icon, hint }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} icon={icon} />
      <EmptyState icon={icon} title="Coming together" hint={hint || 'This area is being built in an upcoming phase.'} />
    </div>
  )
}
