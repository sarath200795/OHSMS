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
    // Locally, reuse whatever is already on 5173 so `npm run dev:full` plus
    // this suite does not fight over the port. In CI it MUST be false: the
    // capped-reads job bakes VITE_TEST_READ_CAP into the Vite process at
    // start-up, and reusing the previous step's server would run those
    // assertions against a bundle that never saw the cap — every notice
    // assertion would pass for the wrong reason. ci.yml's comment on that
    // step already described this; the config is what actually enforces it.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
