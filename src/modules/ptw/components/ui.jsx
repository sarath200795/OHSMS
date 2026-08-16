// Permit-to-work module UI surface.
//
// These primitives used to be a near-verbatim copy of the same components in
// four other modules, each drifting on its own. They now come straight from the
// shared kit, so a fix made once — the modal focus trap, say — reaches every
// module instead of one.
//
// The branded full-screen loader that used to live here is gone too:
// ModuleLoading replaced it, and keeping a second one meant two answers to
// 'what does this app look like while it is loading'.

export { Spinner, Badge, EmptyState, Modal, PageHeader, Field } from '../../../shared/ui'
