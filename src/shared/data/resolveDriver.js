// Which VITE_DATA_DRIVER name is allowed to boot.
//
// supabase is the Supabase client / Realtime flavor of path 3. It stays
// reserved until that adapter exists. postgres is the generic driver and is
// registered; a brought Supabase Postgres uses postgres, not this name.
// Another engine is added to this list in the same change that publishes it,
// or a build that sets the name silently selects Firestore. docs/CUSTOM-STACK.md.
// That fallback is right for a misspelling, and wrong for a name this
// repository has published: the app would keep writing safety records into
// the database the operator thought they had left.
//
// A registered adapter wins over this list. The day a driver file is added
// to DRIVERS it has to be selectable even if this list still mentions it;
// forgetting to delete the name must not brick a finished adapter. Delete it
// in that same change anyway, so the name stops meaning "unimplemented".

export const RESERVED_DATA_DRIVERS = ['supabase']

export class UnimplementedDataDriverError extends Error {
  constructor(driver) {
    super(
      `VITE_DATA_DRIVER=${driver} is a path 3 target and has no adapter. ` +
        'The app will not fall back to Firestore. See docs/CUSTOM-STACK.md.'
    )
    this.name = 'UnimplementedDataDriverError'
    this.driver = driver
  }
}

/**
 * @param {string | undefined} raw  VITE_DATA_DRIVER, as the build supplied it
 * @param {Record<string, unknown>} drivers  the registered adapter map
 * @returns {string} a key of `drivers`, or the string 'firestore' for a typo
 */
export function resolveDataDriver(raw, drivers) {
  const name = String(raw || 'firestore')
    .trim()
    .toLowerCase()
  if (name && Object.hasOwn(drivers, name)) return name
  if (RESERVED_DATA_DRIVERS.includes(name)) throw new UnimplementedDataDriverError(name)
  return 'firestore'
}
