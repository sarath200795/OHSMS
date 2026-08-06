import { defineConfig } from '@playwright/test'

// The smoke suite drives a real browser through the flows the unit tests
// cannot see. It expects the Firebase emulators (auth :9099, firestore :8080)
// to be running and seeded — locally that is `npm run emulators` + `npm run
// seed`; in CI the e2e job wraps everything in `firebase emulators:exec`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // The flows share one seeded org; parallel runs would race each other's data.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    // On failure the trace is the difference between a fix and a shrug.
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
