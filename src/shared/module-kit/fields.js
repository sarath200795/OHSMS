// Reading a module's `fields` config. Shared by the form and the detail view so
// a field that hides itself, or builds its options from live data, behaves the
// same in both — a Region dropdown that only exists at region level must not
// come back as an empty row once the record is saved.

/** Fields that apply to the record as it currently stands. */
export const visibleFields = (fields = [], value = {}) =>
  fields.filter((f) => !f.when || f.when(value))

/**
 * A select's choices. Static lists stay static; a function is re-read on every
 * render against `lookups`, which is how a dropdown tracks a registry that other
 * people are editing while this form is open.
 */
export const fieldOptions = (field, value = {}, lookups = {}) =>
  (typeof field?.options === 'function' ? field.options(value, lookups) : field?.options) || []
