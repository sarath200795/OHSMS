// Small unique-id helper for client-generated nested records (members, hazards,
// controls). Uses crypto.randomUUID when available, with a fallback.
export function uid(prefix = '') {
  const base =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return prefix ? `${prefix}_${base}` : base
}
