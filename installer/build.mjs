// Builds the WEEHS Installer: one program an organization double-clicks.
//
//   node installer/build.mjs --version 2.3.0 --image ghcr.io/OWNER/weehs-dedicated@sha256:… [--out dir]
//
// 1. Joins installer/*.cjs into one script, with the selfhost/ kit, the page
//    and the release baked in. Three local modules do not need a bundler, and
//    a dependency here would ship inside every installer.
// 2. Makes that script a single executable for the platform this runs on
//    (Node's single executable applications, postject), named
//    weehs-installer-<os>-<arch>[.exe]. The release workflow runs this on
//    Linux, Windows and macOS.
// 3. On Windows, marks the program a GUI program, so double-clicking it opens
//    the browser and no console window.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// fileURLToPath, not .pathname: on Windows the pathname of file:///D:/a/x is
// /D:/a/x, which resolve() turns into D:\D:\a\x and the v2.3.0 Windows
// installer build failed reading selfhost/ from there.
const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const version = arg('version', process.env.WEEHS_VERSION || 'development')
const image = arg('image', process.env.WEEHS_IMAGE || '')
const out = resolve(arg('out', join(root, 'dist-installer')))
const scriptOnly = process.argv.includes('--script-only')
if (!image) throw new Error('--image is required: the image this installer installs')

const { KIT } = createRequire(import.meta.url)('./assets.cjs')
const kit = Object.fromEntries(
  KIT.map((name) => [
    name,
    readFileSync(join(root, 'selfhost', name), 'utf8').replace(/\r\n/g, '\n'),
  ])
)
const ui = readFileSync(join(here, 'ui.html'), 'utf8')
const codeUi = readFileSync(join(here, 'code.html'), 'utf8')

const MODULES = ['core.cjs', 'assets.cjs', 'installer.cjs']
const wrapped = MODULES.map(
  (name) =>
    `${JSON.stringify(`./${name}`)}: function (module, exports, require) {\n${readFileSync(join(here, name), 'utf8')}\n}`
).join(',\n')

const bundle = `'use strict'
// Built by installer/build.mjs for WEEHS ${version}. Do not edit; edit installer/.
const __WEEHS_KIT__ = ${JSON.stringify(kit)}
const __WEEHS_UI__ = ${JSON.stringify(ui)}
const __WEEHS_CODE_UI__ = ${JSON.stringify(codeUi)}
const __WEEHS_RELEASE__ = ${JSON.stringify({ version, image })}
const __modules = {
${wrapped}
}
const __cache = {}
function __require(name) {
  if (!(name in __modules)) return require(name)
  if (!__cache[name]) {
    const module = { exports: {} }
    __cache[name] = module
    __modules[name](module, module.exports, __require)
  }
  return __cache[name].exports
}
__require('./installer.cjs').main()
`

mkdirSync(out, { recursive: true })
const script = join(out, 'weehs-installer.cjs')
writeFileSync(script, bundle)
process.stdout.write(`script: ${script}\n`)
if (scriptOnly) process.exit(0)

// ── Single executable ───────────────────────────────────────────────────────
const os =
  { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] || process.platform
const exe = join(
  out,
  `weehs-installer-${os}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
)
const blob = join(out, 'sea-prep.blob')
const seaConfig = join(out, 'sea-config.json')
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: script,
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
  })
)
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' })
copyFileSync(process.execPath, exe)
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe])
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
execFileSync(
  npx,
  [
    '--yes',
    'postject@1.0.0-alpha.6',
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' }
)
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe])
if (process.platform === 'win32') markWindowsGui(exe)
else chmodSync(exe, 0o755)
rmSync(blob, { force: true })
rmSync(seaConfig, { force: true })
process.stdout.write(`installer: ${exe}\n`)

// The PE optional header's Subsystem field: 3 is a console program, which
// Windows opens a black window for; 2 is a GUI program, which it does not.
// Same edit as `editbin /SUBSYSTEM:WINDOWS`, without needing Visual Studio.
function markWindowsGui(file) {
  const buf = readFileSync(file)
  const pe = buf.readUInt32LE(0x3c)
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file')
  const subsystem = pe + 24 + 68
  buf.writeUInt16LE(2, subsystem)
  writeFileSync(file, buf)
}
