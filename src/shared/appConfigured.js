import { isFirebaseConfigured } from './firebase'
import { isOwnStackBuild, ownStackGateway } from './auth/ownStackSession'

/**
 * Whether this build has a backend to talk to, or can only show SetupNeeded.
 *
 * A dedicated own-stack build has no Firebase project at all: its data,
 * sign-in and files go to the company's host (docs/CUSTOM-STACK.md), so its
 * backend is the gateway. Gating it on a Firebase project id, as App.jsx did,
 * made every such deploy carry a placeholder id to get past the setup screen.
 */
export function isAppConfigured({
  ownStack = isOwnStackBuild(),
  gateway = ownStackGateway(),
  firebase = isFirebaseConfigured,
} = {}) {
  return ownStack ? Boolean(gateway) : firebase
}
