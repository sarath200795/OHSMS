import { defineConfig } from 'vitest/config'

// The repo root's config scopes tests to src/**, which is correct for the app
// and wrong here. Without this file, `vitest run` inside functions/ walks up,
// finds that config, and exits "No test files found" — passing CI by testing
// nothing at all.
export default defineConfig({
  // Same upward walk, second victim: vite finds the ROOT postcss.config.js and
  // tries to load tailwindcss, which lives in the root node_modules. On a
  // laptop that resolves, because Node walks up into it. In CI the functions
  // job installs only its own dependencies, so the module is not there and the
  // whole run dies before a single test — "Cannot find module 'tailwindcss'"
  // from a package that has no CSS in it at all.
  //
  // An empty inline config stops the search rather than satisfying it. Nothing
  // here renders, so there is no styling to lose.
  css: { postcss: {} },
  test: {
    // index.js is collected as well as lib/: the destructive half of the
    // retention sweep lives there, and that is the half worth a test.
    include: ['lib/**/*.test.js', 'index.test.js'],
    environment: 'node',
  },
})
