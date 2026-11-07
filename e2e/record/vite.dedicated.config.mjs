// Vite for the dedicated company app in the own-stack walkthrough.
//
// Same build as the shared site, different VITE_ flags (set by the caller, as
// fulfillment's publicEnv would set them on a real deploy). The host's routes
// are proxied onto the app origin so the SAML ACS and the session redirect
// arrive where the app is, the way a single dedicated domain would serve them.
import { defineConfig, mergeConfig } from 'vite'
import base from '../../vite.config.js'

const HOST = process.env.OWNSTACK_HOST_URL || 'http://127.0.0.1:8787'
const routes = ['/data', '/auth', '/presign', '/rpc', '/handoff', '/intake', '/requests', '/health']

export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: Number(process.env.OWNSTACK_APP_PORT || 5174),
      strictPort: true,
      proxy: Object.fromEntries(routes.map((r) => [r, { target: HOST, changeOrigin: false }])),
    },
  })
)
