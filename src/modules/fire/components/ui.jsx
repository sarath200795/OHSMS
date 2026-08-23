// Fire module UI surface.
//
// These primitives used to be a near-verbatim copy of the same components in
// four other modules, each drifting on its own. They now come straight from the
// shared kit, so a fix made once — the modal focus trap, say — reaches every
// module instead of one.
//
// The branded full-screen loader that used to live here is gone too:
// ModuleLoading replaced it, and keeping a second one meant two answers to
// 'what does this app look like while it is loading'.

// Field is here for the same reason as the rest. Eight files in this module
// each declared their own
//   function Field({ label, children }) {
//     return <div><label className="label">{label}</label>{children}</div>
//   }
// — the same four lines, eight times, and every one of them rendered a <label>
// with no htmlFor beside a control with no id. So the label was on screen and
// attached to nothing: a screen reader read the Add Extinguisher form as eight
// unnamed boxes. The shared Field generates the id and puts it on the child, so
// deleting those eight copies is the fix, not just tidying.
export { Spinner, Badge, EmptyState, Modal, PageHeader, Field, IconButton } from '../../../shared/ui'
