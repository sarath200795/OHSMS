import { defineConfig } from 'vitest/config'

// The repo root's config scopes tests to src/**, which is correct for the app
// and wrong here. Without this file, `vitest run` inside functions/ walks up,
// finds that config, and exits "No test files found" — passing CI by testing
// nothing at all.
export default defineConfig({
  test: {
    // index.js is collected as well as lib/: the destructive half of the
    // retention sweep lives there, and that is the half worth a test.
    include: ['lib/**/*.test.js', 'index.test.js'],
    environment: 'node',
  },
})
