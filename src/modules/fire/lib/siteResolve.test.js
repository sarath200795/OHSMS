import { describe, it, expect } from 'vitest'
import { siteIndex, withSite, withSites } from './siteResolve'

const sites = [
  { id: 's1', name: 'Warehouse — Hosur', region: 'South', entity: 'FOCO' },
  { id: 's2', name: 'North Plant', region: 'North', entity: 'COCO' },
]
const index = siteIndex(sites)

const ext = (o = {}) => ({ id: 'e1', serialNo: 'EXT-1', siteId: 's1', ...o })

describe('siteIndex', () => {
  it('keys sites by id', () => {
    expect(index.get('s1').name).toBe('Warehouse — Hosur')
  })

  it('ignores sites with no id, which could never be matched', () => {
    expect(siteIndex([{ name: 'Ghost' }]).size).toBe(0)
  })
})

describe('withSite', () => {
  // The case that prompted this: a unit that knows its site but shows blanks.
  it('fills in a blank center, region and entity from the registry', () => {
    expect(withSite(ext(), index)).toMatchObject({
      centerName: 'Warehouse — Hosur',
      region: 'South',
      entity: 'FOCO',
    })
  })

  // A unit labelled differently from its site is describing something real —
  // a wing, a floor, a leased corner — and must not be overwritten.
  it('never overrides a value the asset already carries', () => {
    const own = ext({ centerName: 'Bay 3 mezzanine', region: 'West', entity: 'FOFO' })
    expect(withSite(own, index)).toMatchObject({
      centerName: 'Bay 3 mezzanine',
      region: 'West',
      entity: 'FOFO',
    })
  })

  it('fills only the fields that are actually blank', () => {
    expect(withSite(ext({ centerName: 'Bay 3' }), index)).toMatchObject({
      centerName: 'Bay 3',
      region: 'South',
      entity: 'FOCO',
    })
  })

  it('treats whitespace as blank', () => {
    expect(withSite(ext({ region: '   ' }), index).region).toBe('South')
  })

  it('leaves an asset alone when its site is not in the registry', () => {
    const orphan = ext({ siteId: 'gone' })
    expect(withSite(orphan, index)).toBe(orphan)
  })

  it('leaves an asset with no siteId alone', () => {
    const none = ext({ siteId: '' })
    expect(withSite(none, index)).toBe(none)
  })

  // A list of thousands re-renders on every pass otherwise.
  it('returns the SAME object when nothing needed filling', () => {
    const complete = ext({ centerName: 'X', region: 'Y', entity: 'Z' })
    expect(withSite(complete, index)).toBe(complete)
  })

  it('survives null', () => {
    expect(withSite(null, index)).toBeNull()
  })
})

describe('withSites', () => {
  it('resolves a list and preserves order', () => {
    const rows = withSites([ext({ id: 'a' }), ext({ id: 'b', siteId: 's2' })], sites)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows[0].centerName).toBe('Warehouse — Hosur')
    expect(rows[1].centerName).toBe('North Plant')
  })

  it('is a no-op when the registry is empty, rather than blanking anything', () => {
    const rows = [ext({ centerName: 'Kept' })]
    expect(withSites(rows, [])).toBe(rows)
  })

  it('handles an empty asset list', () => {
    expect(withSites([], sites)).toEqual([])
  })
})
