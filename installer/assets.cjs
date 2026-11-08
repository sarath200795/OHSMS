// What the installer carries: the selfhost/ kit, its own page, and which
// release it installs. build.mjs replaces the __WEEHS_*__ names with the
// files' contents, so the built program is one file that needs nothing next
// to it. Run from the repository instead (node installer/installer.cjs), the
// files are read from disk.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const KIT = ['compose.yaml', 'Caddyfile', 'init-db.sh', '.env.example']

/* global __WEEHS_KIT__, __WEEHS_UI__, __WEEHS_CODE_UI__, __WEEHS_RELEASE__ */

function kitFiles() {
  if (typeof __WEEHS_KIT__ !== 'undefined') return __WEEHS_KIT__
  const dir = path.join(__dirname, '..', 'selfhost')
  return Object.fromEntries(
    KIT.map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')])
  )
}

function uiHtml() {
  if (typeof __WEEHS_UI__ !== 'undefined') return __WEEHS_UI__
  return fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8')
}

/** The page on the server's own screen: the installer code. */
function codeHtml() {
  if (typeof __WEEHS_CODE_UI__ !== 'undefined') return __WEEHS_CODE_UI__
  return fs.readFileSync(path.join(__dirname, 'code.html'), 'utf8')
}

/** The release this installer was built for: its version and image. */
function releaseInfo() {
  if (typeof __WEEHS_RELEASE__ !== 'undefined') return __WEEHS_RELEASE__
  return {
    version: process.env.WEEHS_VERSION || 'development',
    image: process.env.WEEHS_IMAGE || 'ghcr.io/OWNER/weehs-dedicated:latest',
  }
}

module.exports = { KIT, kitFiles, uiHtml, codeHtml, releaseInfo }
