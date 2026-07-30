import { Outlet } from 'react-router-dom'
import AppChrome from '../../shared/layout/AppChrome'

// The portal's routes nest, so they render through an Outlet; every other route
// in the app passes its element to AppChrome as children. Same chrome either
// way — that is the whole point of it living in shared/layout.
export default function PortalLayout() {
  return (
    <AppChrome>
      <Outlet />
    </AppChrome>
  )
}
