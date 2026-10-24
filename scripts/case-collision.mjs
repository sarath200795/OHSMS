#!/usr/bin/env node
/**
 * Refuse a tree that a case-insensitive disk cannot check out unambiguously.
 *
 * macOS and Windows fold filenames. The production build failed only there:
 * OrgSettings imported './WhatsAppConnect' with no extension, Vite probes
 * '.js' before '.jsx', and the volume bound whatsappConnect.js. That module
 * has no default export, so the build died with "default" is not exported.
 * Linux keeps both spellings, so CI is the place that can refuse the pair.
 *
 * Two checks, because that pair is not a full-path collision — the extensions
 * differ:
 *
 *   1. Any two paths, including a parent directory, that are equal ignoring
 *      case. The checkout keeps one and the other file is simply gone.
 *   2. Any two JS modules whose paths are equal ignoring case once the final
 *      extension is removed. An extensionless import cannot choose between
 *      them, and '.js' wins.
 *
 * `.env.example` beside `.env.something` is not a hit: those names differ by
 * more than case, and they are not modules.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SKIP = new Set(['node_modules', 'dist'])
const MODULE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx)$/

/** Every ancestor of a file, including the file. `src/a/b.js` -> src, src/a, src/a/b.js. */
export function pathPrefixes(file) {
  const parts = file.split('/')
  const out = []
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/** Path with the final module extension removed, or null when it is not a module. */
export function moduleStem(file) {
  if (!MODULE_EXT.test(file)) return null
  return file.replace(MODULE_EXT, '')
}

function groupsThatDifferOnlyByCase(entries) {
  // Group by the folded key. A hit is two different spellings of that key,
  // not two files that share one spelling and differ by extension
  // (`foo.js` beside `foo.jsx` is the same stem, so it is not a case collision).
  const byFold = new Map()
  for (const entry of entries) {
    const fold = entry.key.toLowerCase()
    if (!byFold.has(fold)) byFold.set(fold, new Map())
    const spellings = byFold.get(fold)
    if (!spellings.has(entry.key)) spellings.set(entry.key, new Set())
    spellings.get(entry.key).add(entry.label)
  }
  const hits = []
  for (const spellings of byFold.values()) {
    if (spellings.size < 2) continue
    const labels = new Set()
    for (const set of spellings.values()) for (const label of set) labels.add(label)
    hits.push([...labels].sort())
  }
  return hits.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/**
 * @param {string[]} filePaths repo-relative paths using `/`
 * @returns {{ kind: 'path' | 'module', paths: string[] }[]}
 */
export function findCaseCollisions(filePaths) {
  const pathHits = groupsThatDifferOnlyByCase(
    filePaths.flatMap((file) => pathPrefixes(file).map((key) => ({ key, label: key })))
  ).map((paths) => ({ kind: 'path', paths }))

  const moduleHits = groupsThatDifferOnlyByCase(
    filePaths.flatMap((file) => {
      const stem = moduleStem(file)
      return stem ? [{ key: stem, label: file }] : []
    })
  ).map((paths) => ({ kind: 'module', paths }))

  return [...pathHits, ...moduleHits]
}

export function collectFiles(roots) {
  const out = []
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (err && err.code === 'ENOENT') return
      throw err
    }
    for (const ent of entries) {
      if (SKIP.has(ent.name)) continue
      const next = join(dir, ent.name).split('\\').join('/')
      if (ent.isDirectory()) walk(next)
      else if (ent.isFile()) out.push(next)
    }
  }
  for (const root of roots) walk(root)
  return out
}

export function report(collisions) {
  if (collisions.length === 0) {
    console.log('case-collision: ok')
    return 0
  }
  console.error('case-collision: a case-insensitive checkout cannot keep both names')
  for (const hit of collisions) {
    const why =
      hit.kind === 'module'
        ? 'equal ignoring case once the extension is removed, so an extensionless import ' +
          'binds the wrong file'
        : 'equal ignoring case, so the checkout keeps only one'
    console.error(`  ${why}`)
    for (const p of hit.paths) console.error(`    ${p}`)
  }
  return 1
}

function isCli() {
  const entry = process.argv[1]
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href
}

if (isCli()) {
  process.exit(report(findCaseCollisions(collectFiles(['src', 'functions']))))
}
