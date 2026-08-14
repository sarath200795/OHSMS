#!/usr/bin/env node
/**
 * Refuse to start the rules suite when its ports are already occupied.
 *
 * The emulator does not always fail cleanly on a collision. When the hub's port
 * was taken it printed `hub unable to start on port 4400, starting on 4401
 * instead`, carried on against a second suite for the same project, and then
 * Firestore exited with code 1 partway through — one test file red, the other
 * seven green, and no assertion anywhere to explain it. That is what an
 * intermittent security-rules failure looked like, and it is the kind that gets
 * re-run until it passes rather than diagnosed.
 *
 * firebase.rulestest.json now pins every port this suite opens. This checks they
 * are actually free before a single test runs, so a leftover emulator is a
 * one-line error naming the process to kill, not a flake.
 */
import net from 'node:net'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../firebase.rulestest.json', import.meta.url), 'utf8'))
const e = cfg.emulators || {}

const PORTS = [
  ['firestore', e.firestore?.port],
  ['firestore websocket', e.firestore?.websocketPort],
  ['storage', e.storage?.port],
  ['hub', e.hub?.port],
  ['logging', e.logging?.port],
].filter(([, p]) => Number.isInteger(p))

const inUse = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', (err) => resolve(err.code === 'EADDRINUSE'))
    srv.once('listening', () => srv.close(() => resolve(false)))
    srv.listen(port, '127.0.0.1')
  })

const taken = []
for (const [name, port] of PORTS) {
  if (await inUse(port)) taken.push({ name, port })
}

if (taken.length) {
  console.error('\nrules-preflight: the rules emulator ports are not free.\n')
  for (const t of taken) console.error(`  ${t.port}  ${t.name}`)
  console.error(`
Almost always a previous emulator that did not shut down — an interrupted
test run leaves the Java process listening. Find and stop it:

  Windows:  netstat -ano | findstr LISTENING | findstr ${taken[0].port}
            taskkill /PID <pid> /F
  macOS/Linux:  lsof -ti tcp:${taken[0].port} | xargs kill

Running anyway is what produced the intermittent failures this check exists
to prevent, so this is a hard stop rather than a warning.
`)
  process.exit(1)
}

console.log(`rules-preflight: ${PORTS.length} ports free.`)
