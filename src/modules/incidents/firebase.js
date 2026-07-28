// Adapter: the ported incident-ira code imports `../firebase`; route that to the
// shared, single Firebase app so the whole platform shares one auth session and
// one Firestore/Storage instance.
export * from '../../shared/firebase'
export { default } from '../../shared/firebase'
