import { Select, Button } from '../../../shared/ui'
import { useCctv } from '../context/CctvContext'

/**
 * Site / entity / region scope, shared by every tab in the module.
 *
 * Deliberately rendered by the module shell rather than by each page. The scope
 * belongs to the investigation, not the screen: moving from Health to Defects
 * while looking at one region and silently getting the whole estate back is how
 * a number ends up quoted for the wrong thing.
 *
 * Entity and region resolve through the site record rather than being stored on
 * each device, so a site moved between entities takes its cameras with it.
 */
export default function ScopeBar() {
  const { scope, setScope, clearScope, isScoped, facets, sitesInScope, estate, fullEstate } = useCctv()

  const nothingToFilter = facets.entities.length === 0 && facets.regions.length === 0 && sitesInScope.length === 0
  if (nothingToFilter) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select
        aria-label="Filter by entity"
        className="w-auto"
        value={scope.entity}
        onChange={(e) => setScope({ entity: e.target.value })}
      >
        <option value="">All entities</option>
        {facets.entities.map((x) => <option key={x} value={x}>{x}</option>)}
      </Select>

      <Select
        aria-label="Filter by region"
        className="w-auto"
        value={scope.region}
        onChange={(e) => setScope({ region: e.target.value })}
      >
        <option value="">All regions</option>
        {facets.regions.map((x) => <option key={x} value={x}>{x}</option>)}
      </Select>

      {/* Only the sites the chosen entity/region can contain, so no combination
          can be built that is guaranteed to return nothing. */}
      <Select
        aria-label="Filter by site"
        className="w-auto"
        value={scope.siteId}
        onChange={(e) => setScope({ siteId: e.target.value })}
      >
        <option value="">All sites</option>
        {sitesInScope.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>

      {isScoped && (
        <>
          <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={clearScope}>
            Clear filters
          </Button>
          {/* Every page below is scoped, so say so once here — a filtered figure
              must never be mistaken for the size of the estate. */}
          <span className="text-xs text-ink-500">
            Showing {estate.cameras.length} of {fullEstate.cameras.length} cameras
            {' · '}
            {estate.dvrs.length}/{fullEstate.dvrs.length} DVR
            {' · '}
            {estate.merakis.length}/{fullEstate.merakis.length} Meraki
          </span>
        </>
      )}
    </div>
  )
}
