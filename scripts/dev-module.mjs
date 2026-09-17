#!/usr/bin/env node
// Isolated module-app dev server. Same Firebase emulators as the shell.
//
//   npm run emulators          # terminal 1
//   npm run dev:shell          # terminal 2  (or npm run dev:apps)
//   npm run dev:module -- incidents
//
// Different ports are different origins, so Firebase Auth is not shared.
// Prefer `npm run dev:apps` for same-origin shell + modules.
import { spawn } from 'node:child_process'
import { OPERATING_APP_BY_KEY } from '../src/shared/modules/apps.js'

const key = process.argv[2] || 'incidents'
if (!OPERATING_APP_BY_KEY[key]) {
  console.error(`Unknown module '${key}'. One of: ${Object.keys(OPERATING_APP_BY_KEY).join(', ')}`)
  process.exit(1)
}

const port = Number(process.env.PORT) || 5174
const env = {
  ...process.env,
  VITE_SHELL_ORIGIN: process.env.VITE_SHELL_ORIGIN || 'http://localhost:5173',
}

const child = spawn(
  'npx',
  [
    'vite',
    '--config',
    'vite.apps.config.js',
    '--port',
    String(port),
    '--open',
    OPERATING_APP_BY_KEY[key].pathPrefix,
  ],
  { stdio: 'inherit', env, shell: process.platform === 'win32' }
)
child.on('exit', (code) => process.exit(code || 0))
