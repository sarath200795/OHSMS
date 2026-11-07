// Static files for the dedicated host.
//
// The control-plane routes answer first. What remains, after fulfillment, is
// the built SPA: `/` and the app's paths return index.html, and a file that
// exists under dist/ is that file. A missing hashed asset must not fall
// through to index.html — the browser would treat the HTML as a script.
//
// The path is resolved and then checked against the root. A `..` segment is
// refused before that, because normalising it and hoping the prefix check
// holds is how a request for the repo next to dist/ gets served.

import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { injectStackEnvScript } from './publicEnv.mjs'

const LEGAL = new Map([
  ['/privacy', '/privacy.html'],
  ['/privacy/', '/privacy.html'],
  ['/terms', '/terms.html'],
  ['/terms/', '/terms.html'],
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
}

export function contentTypeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

export async function resolveSpaRequest(root, pathname) {
  const rootAbs = resolve(root)
  const requested = LEGAL.get(pathname) || pathname
  let decoded
  try {
    decoded = decodeURIComponent(requested)
  } catch {
    return { kind: 'forbidden' }
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    return { kind: 'forbidden' }
  }
  const rel = decoded.replace(/^\/+/, '')
  if (rel.split('/').some((part) => part.startsWith('.'))) return { kind: 'forbidden' }
  const indexPath = resolve(rootAbs, 'index.html')
  const indexReady = await isFile(indexPath)
  if (!rel) return indexReady ? { kind: 'index', path: indexPath } : { kind: 'unbuilt' }
  const full = resolve(rootAbs, rel)
  if (full !== rootAbs && !full.startsWith(`${rootAbs}${sep}`)) return { kind: 'forbidden' }
  if (await isFile(full)) {
    return { kind: 'file', path: full, hashed: full.includes(`${sep}assets${sep}`) }
  }
  if (extname(rel)) return { kind: 'missing' }
  return indexReady ? { kind: 'index', path: indexPath } : { kind: 'unbuilt' }
}

async function isFile(filePath) {
  try {
    const info = await stat(filePath)
    return info.isFile()
  } catch {
    return false
  }
}

export async function readSpaBody(hit) {
  if (hit.kind === 'index') {
    const html = await readFile(hit.path, 'utf8')
    return { body: injectStackEnvScript(html), type: 'text/html; charset=utf-8', hashed: false }
  }
  const body = await readFile(hit.path)
  return { body, type: contentTypeFor(hit.path), hashed: Boolean(hit.hashed) }
}
