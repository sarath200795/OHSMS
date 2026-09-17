import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OPERATING_APPS, appIndexPath } from './apps'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('firebase hosting rewrites', () => {
  it('send each module prefix to that module’s app, not the shell', () => {
    const json = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const rewrites = json.hosting.rewrites || []
    for (const app of OPERATING_APPS) {
      const exact = rewrites.find((r) => r.source === app.pathPrefix)
      const splat = rewrites.find((r) => r.source === `${app.pathPrefix}/**`)
      expect(exact?.destination, app.pathPrefix).toBe(appIndexPath(app.key))
      expect(splat?.destination, `${app.pathPrefix}/**`).toBe(appIndexPath(app.key))
    }
    const catchAll = rewrites[rewrites.length - 1]
    expect(catchAll).toEqual({ source: '**', destination: '/index.html' })
  })
})
