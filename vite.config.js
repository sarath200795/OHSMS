import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
    // Heavy libs (three.js, react-flow, xlsx, pdf) are lazy-loaded per module
    // route. Split the always-loaded vendors so the initial bundle stays lean.
    chunkSizeWarningLimit: 900,
    // Vite 8 builds with Rolldown, which accepts manualChunks only as a
    // function. Same split as the object form: the always-loaded vendors
    // leave the entry chunk.
    //
    // A service worker's scope is the directory it is served from. A hashed
    // file under /assets/ would only control /assets/, and
    // `new URL('./sw.js', import.meta.url)` is inlined as a data: URL (the
    // source is under the asset inline limit), which the CSP refuses and
    // which still contains an unresolved import. The root file is no-cache
    // in firebase.json so a deploy can replace it; the year-long immutable
    // rule on **/*.js would otherwise pin it.
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        sw: fileURLToPath(new URL('./src/shared/mobile/sw.js', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        manualChunks(id) {
          const pkg = (name) => id.includes(`/node_modules/${name}/`)
          if (pkg('react') || pkg('react-dom') || pkg('react-router') || pkg('react-router-dom')) {
            return 'react'
          }
          if (
            pkg('firebase/app') ||
            pkg('firebase/auth') ||
            pkg('firebase/firestore') ||
            pkg('@firebase/app') ||
            pkg('@firebase/auth') ||
            pkg('@firebase/firestore')
          ) {
            return 'firebase'
          }
          if (pkg('recharts')) return 'charts'
          if (pkg('framer-motion')) return 'motion'
        },
      },
    },
  },
})
