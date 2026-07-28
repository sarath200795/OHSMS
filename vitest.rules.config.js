import { defineConfig } from 'vitest/config'

// Security-rules tests run in Node against the Firestore emulator (started by
// `firebase emulators:exec`). Kept separate from the jsdom unit suite.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
})
