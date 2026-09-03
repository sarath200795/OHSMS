// Every listener in this module was opened WITHOUT an error callback, which
// left InternalAudit, CapaRegister and FindingsRegister on their empty state
// permanently after any read failure — reading as an org with no audit
// programme rather than a module that could not read one.
//
// The implementation now lives in shared/snapshotError.js, because the same
// omission existed in incidents, inspections and PTW. Re-exported rather than
// rewritten so the five call sites here keep their import.
export { snapshotHandlers } from '../../../shared/snapshotError'
