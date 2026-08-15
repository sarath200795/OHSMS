import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The repo root's config scopes tests to src/** with a jsdom environment, which
// is correct for the app and wrong here. Without this file, `vitest run` inside
// server/ walks up, finds that config, matches nothing, and exits "No test files
// found" — passing CI by testing nothing at all. functions/ carries the same
// file for the same reason.
//
// `root` is pinned to this directory rather than left to cwd so the suite runs
// the same from the repo root (`vitest run --config server/vitest.config.js`)
// as it does from here. A test suite that only passes from one directory is a
// test suite somebody eventually stops running.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    // `test/` as well as `src/`, because the attack suite is not a unit test of
    // any one file — it is the whole app, with a real token and a real
    // Firestore, being asked whether it can be made to write where it must not.
    // Putting it beside the module it attacks would file it under that module's
    // coverage, and it belongs to no module: it stands in for firestore.rules.
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
    environment: 'node',
    // The route suite talks to the Firestore and Auth emulators, and a cold
    // emulator on a laptop is slower than the 5s default by enough to fail a
    // correct test. The root's rules suite settled on the same number for the
    // same reason. It costs nothing for the unit tests, which finish in
    // milliseconds either way.
    testTimeout: 20_000,
    // Longer still, because the setup hook creates the auth users and mints
    // their tokens — a handful of round trips before the first assertion.
    hookTimeout: 60_000,
  },
})
