import { createContext, useContext } from 'react'

// The bar and the Alerts screen share one feed. A missing provider means the
// bar draws with no badge — desktop tests render the bar without mounting the
// listeners, and a badge of zero is the honest answer there.
const AlertFeedContext = createContext({
  items: [],
  unread: 0,
  ready: false,
  markRead: () => {},
  markAllRead: () => {},
})

export const AlertFeedProviderContext = AlertFeedContext.Provider

export function useAlertFeedContext() {
  return useContext(AlertFeedContext)
}

export function useAlertUnread() {
  return useContext(AlertFeedContext).unread
}
