// Files the self-host process loads before it listens.
//
// The first Mac image copied stack/ and postgresWire.js, then npm ci. Node
// still evaluates every static import before the secret files are read, and
// presign.mjs imports functions/lib/fileDelete.js. That file was not in the
// image, so the container restarted with ERR_MODULE_NOT_FOUND and :8787 never
// opened. Copying that one file would miss the next import (workers.mjs pulls
// retention, which pulls subjectData.js). This walk is the list the image
// must contain.

import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '../..')
const ENTRY = 'stack/self-host.mjs'

const SPECIFIER =
  /(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const ASSET =
  /(?:readFileSync|readFile)\(\s*join\(\s*dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)\s*,\s*['"]([^'"]+)['"]\s*\)/g

function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

function packageName(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return `${scope}/${name}`
  }
  return specifier.split('/')[0]
}

export function runtimeClosure(root = REPO_ROOT) {
  const files = new Set()
  const packages = new Set()
  const queue = [ENTRY]
  while (queue.length) {
    const rel = queue.pop()
    if (files.has(rel)) continue
    files.add(rel)
    const src = strip(readFileSync(join(root, rel), 'utf8'))
    SPECIFIER.lastIndex = 0
    let match = SPECIFIER.exec(src)
    while (match) {
      const spec = match[1] || match[2]
      if (spec.startsWith('.')) {
        const next = relative(root, resolve(root, dirname(rel), spec))
          .split('\\')
          .join('/')
        queue.push(next)
      } else if (!spec.startsWith('node:')) {
        packages.add(packageName(spec))
      }
      match = SPECIFIER.exec(src)
    }
    ASSET.lastIndex = 0
    let asset = ASSET.exec(src)
    while (asset) {
      const next = relative(root, resolve(root, dirname(rel), asset[1]))
        .split('\\')
        .join('/')
      files.add(next)
      asset = ASSET.exec(src)
    }
  }
  return {
    files: [...files].sort(),
    packages: [...packages].sort(),
  }
}

function lockPath(packages, from, name) {
  const bases = []
  let cursor = from
  if (cursor) bases.push(cursor)
  while (cursor.includes('/node_modules/')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('/node_modules/'))
    if (cursor) bases.push(cursor)
  }
  bases.push('')
  for (const base of bases) {
    const path = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
    if (packages[path]) return path
  }
  return ''
}

// Bare specifiers have to be reachable from package.json "dependencies".
// npm ci --omit=dev drops the rest. A devDependency that happens to be in
// this checkout's node_modules would still import on the workstation.
export function productionPackages(root = REPO_ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const packages = lock.packages || {}
  const names = new Set()
  const queue = Object.keys(packages['']?.dependencies || {}).map((name) => ({
    from: '',
    name,
  }))
  const seen = new Set()
  while (queue.length) {
    const item = queue.shift()
    const key = `${item.from}=>${item.name}`
    if (seen.has(key)) continue
    seen.add(key)
    names.add(item.name)
    const resolved = lockPath(packages, item.from, item.name)
    const meta = resolved ? packages[resolved] : null
    if (!meta) continue
    for (const dep of Object.keys(meta.dependencies || {})) {
      queue.push({ from: resolved, name: dep })
    }
  }
  return names
}

export function dockerCopies(dockerfile) {
  const copies = []
  for (const line of dockerfile.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('COPY ')) continue
    const parts = trimmed.slice(5).trim().split(/\s+/)
    const dest = parts.pop()
    for (const src of parts) copies.push({ src, dest })
  }
  return copies
}

export function copyCovers(copies, relPath) {
  return copies.some(({ src }) => {
    const appRel = src.startsWith('app/') ? src.slice(4) : src
    return relPath === appRel || relPath.startsWith(`${appRel}/`)
  })
}
