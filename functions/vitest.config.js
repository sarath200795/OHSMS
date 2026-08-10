import { defineConfig } from 'vitest/config'

// The repo root's config scopes tests to src/**, which is correct for the app
// and wrong here. Without this file, `vitest run` inside functions/ walks up,
// finds that config, and exits "No test files found" — passing CI by testing
// nothing at all.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.js'],
    environment: 'node',
  },
})
