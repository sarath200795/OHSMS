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
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        // A service worker's scope is the directory it is served from. A
        // hashed file under /assets/ would only control /assets/, and
        // `new URL('./sw.js', import.meta.url)` is inlined as a data: URL
        // (the source is under the asset inline limit), which the CSP
        // refuses and which still contains an unresolved import. The root
        // file is no-cache in firebase.json so a deploy can replace it;
        // the year-long immutable rule on **/*.js would otherwise pin it.
        sw: fileURLToPath(new URL('./src/shared/mobile/sw.js', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
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
