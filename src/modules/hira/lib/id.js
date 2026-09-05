// The shared helper, re-exported so this module's many call sites keep their
// import path. There were two copies of this function; a second one is how the
// two drift, and one of them was already a clock.
export { uid } from '../../../shared/lib/id'
