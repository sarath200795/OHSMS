import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { OPERATING_APPS } from './src/shared/modules/apps.js'

function fallbackToAppHtml(url) {
  const path = url.split('?')[0]
  if (path.startsWith('/@') || path.startsWith('/node_modules') || path.startsWith('/src/'))
    return null
  if (/\.[a-zA-Z0-9]+$/.test(path) && !path.endsWith('.html')) return null
  for (const app of OPERATING_APPS) {
    if (path === app.pathPrefix || path.startsWith(`${app.pathPrefix}/`)) {
      return `/apps/${app.key}/index.html`
    }
  }
  if (!path.startsWith('/apps/')) return '/apps/shell/index.html'
  return null
}

function multiAppFallback() {
  const middleware = (req, _res, next) => {
    const dest = fallbackToAppHtml(req.url || '')
    if (dest) req.url = dest
    next()
  }
  return {
    name: 'ohsms-multi-app-fallback',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
    closeBundle() {
      const from = fileURLToPath(new URL('./dist/apps/shell/index.html', import.meta.url))
      const to = fileURLToPath(new URL('./dist/index.html', import.meta.url))
      if (existsSync(from)) {
        mkdirSync(fileURLToPath(new URL('./dist', import.meta.url)), { recursive: true })
        copyFileSync(from, to)
      }
    },
  }
}

const input = {
  shell: fileURLToPath(new URL('./apps/shell/index.html', import.meta.url)),
  ...Object.fromEntries(
    OPERATING_APPS.map((a) => [
      a.key,
      fileURLToPath(new URL(`./apps/${a.key}/index.html`, import.meta.url)),
    ])
  ),
}

export default defineConfig({
  plugins: [react(), multiAppFallback()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input,
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
})
