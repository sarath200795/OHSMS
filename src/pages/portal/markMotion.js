// Desktop home tiles. The phone grid does not use this class: it keeps the
// continuous idle the mobile home was asked for.
//
// `playing` on the tile ran every 3D logo the moment the grid opened.
// Hover and keyboard focus start that loop, and index.css limits it to a
// fine pointer. Reduced motion still cancels it.

export function desktopMarkClass(has3D) {
  return has3D ? 'logo-hover logo-phase' : 'logo-hover'
}
