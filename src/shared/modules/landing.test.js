import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OPERATING_APP_BY_KEY, OPERATING_APPS, appIndexPath } from './apps'
import {
  AUTH_AUTHORIZED_HOSTS,
  LANDING_ENTRY_PATHS,
  LANDING_ENTRY_ROUTES,
  LANDING_PRODUCTS,
  PUBLIC_SHELL_ORIGIN,
  landingHandoffUrl,
  landingOpenPath,
  landingProductRoutes,
  landingProductUrl,
} from './landing'
import { pathIsOwned } from './ownership'
import { loginPathFor } from '../auth/continueTo'
import { MODULE_BY_KEY } from './registry'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('landing handoff contract', () => {
  it('names the three shell paths weehs-landing appends for OHS Suite', () => {
    expect(LANDING_ENTRY_PATHS).toEqual(['/login', '/register-org', '/signup'])
    expect(LANDING_ENTRY_ROUTES).toHaveLength(3)
  })

  it('gives those paths to the shell, never a module app', () => {
    for (const path of LANDING_ENTRY_PATHS) {
      expect(pathIsOwned(path, 'shell'), path).toBe(true)
      expect(pathIsOwned(path, 'module', 'incidents'), path).toBe(false)
    }
  })

  it('does not collide with a module hosting prefix', () => {
    const prefixes = new Set(OPERATING_APPS.map((a) => a.pathPrefix))
    for (const path of LANDING_ENTRY_PATHS) {
      expect(prefixes.has(path), path).toBe(false)
    }
  })

  it('is mounted on the shell App, under those exact paths', () => {
    const app = readFileSync(join(root, 'src/App.jsx'), 'utf8')
    for (const path of LANDING_ENTRY_PATHS) {
      expect(app, path).toContain(`path="${path}"`)
    }
  })

  it('is not stolen by a firebase hosting rewrite to a module app', () => {
    const json = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const rewrites = json.hosting.rewrites || []
    for (const path of LANDING_ENTRY_PATHS) {
      const hit = rewrites.find((r) => r.source === path || r.source === `${path}/**`)
      expect(hit, path).toBeUndefined()
    }
  })

  it('publishes the origin landing should open', () => {
    expect(PUBLIC_SHELL_ORIGIN).toBe('https://suite.weehs.org')
    expect(landingHandoffUrl('/login')).toBe('https://suite.weehs.org/login')
    expect(landingHandoffUrl('/register-org')).toBe('https://suite.weehs.org/register-org')
    expect(landingHandoffUrl('/signup')).toBe('https://suite.weehs.org/signup')
  })

  it('names the Auth host the shell runs on, not the landing host', () => {
    expect(AUTH_AUTHORIZED_HOSTS).toEqual(['suite.weehs.org'])
    expect(AUTH_AUTHORIZED_HOSTS).not.toContain('weehs.org')
    expect(AUTH_AUTHORIZED_HOSTS).not.toContain('www.weehs.org')
  })

  it('documents the origin and routes where landing looks', () => {
    const env = readFileSync(join(root, '.env.example'), 'utf8')
    expect(env).toContain('VITE_PUBLIC_ORIGIN=')
    expect(env).toContain('https://suite.weehs.org')
    const docs = readFileSync(join(root, 'docs/APPS.md'), 'utf8')
    for (const path of LANDING_ENTRY_PATHS) {
      expect(docs, path).toContain(path)
    }
    expect(docs).toContain('suite.weehs.org')
    expect(docs).toContain('weehs-landing')
  })

  it('sends unknown paths to the shell, not a module app', () => {
    const json = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const catchAll = (json.hosting.rewrites || []).at(-1)
    expect(catchAll).toEqual({ source: '**', destination: '/index.html' })
  })
})

describe('landing product cards → OHSMS', () => {
  const expected = {
    'fire-marshal': { moduleKey: 'equipment', openPath: '/equipment' },
    hecp: { moduleKey: 'loto', openPath: '/loto' },
    'permit-to-work': { moduleKey: 'ptw', openPath: '/permits' },
    'iso-45001-auditor': { moduleKey: 'audit', openPath: '/audit' },
    hira: { moduleKey: 'hira', openPath: '/hira' },
    'ohs-suite': { moduleKey: null, openPath: '/login' },
  }

  it('maps all six landing products, using real registry keys and prefixes', () => {
    expect(LANDING_PRODUCTS.map((p) => p.id)).toEqual(Object.keys(expected))
    for (const product of LANDING_PRODUCTS) {
      const want = expected[product.id]
      expect(product.moduleKey, product.id).toBe(want.moduleKey)
      expect(landingOpenPath(product), product.id).toBe(want.openPath)
      if (product.moduleKey) {
        expect(OPERATING_APP_BY_KEY[product.moduleKey].pathPrefix).toBe(want.openPath)
        expect(MODULE_BY_KEY[product.moduleKey].path).toBe(want.openPath)
      }
    }
  })

  it('does not use the filesystem folder or the registry key as the URL', () => {
    // Fire lives in src/modules/fire/; Permit to Work’s key is ptw.
    expect(landingOpenPath(LANDING_PRODUCTS[0])).toBe('/equipment')
    expect(landingOpenPath(LANDING_PRODUCTS[2])).toBe('/permits')
    expect(landingOpenPath(LANDING_PRODUCTS[0])).not.toBe('/fire')
    expect(landingOpenPath(LANDING_PRODUCTS[2])).not.toBe('/ptw')
  })

  it('rewrites each module product to that module’s app, not the shell', () => {
    const json = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const rewrites = json.hosting.rewrites || []
    for (const product of LANDING_PRODUCTS.filter((p) => p.moduleKey)) {
      const prefix = landingOpenPath(product)
      const exact = rewrites.find((r) => r.source === prefix)
      const splat = rewrites.find((r) => r.source === `${prefix}/**`)
      expect(exact?.destination, prefix).toBe(appIndexPath(product.moduleKey))
      expect(splat?.destination, `${prefix}/**`).toBe(appIndexPath(product.moduleKey))
      expect(pathIsOwned(prefix, 'shell'), prefix).toBe(false)
      expect(pathIsOwned(prefix, 'module', product.moduleKey), prefix).toBe(true)
    }
  })

  it('tells landing to deep-link the module and to carry ?next= on register/join', () => {
    const fire = LANDING_PRODUCTS[0]
    expect(landingProductRoutes(fire)).toEqual({
      login: '/equipment',
      register: '/register-org?next=%2Fequipment',
      join: '/signup?next=%2Fequipment',
    })
    const suite = LANDING_PRODUCTS.find((p) => p.id === 'ohs-suite')
    expect(landingProductRoutes(suite)).toEqual({
      login: '/login',
      register: '/register-org',
      join: '/signup',
    })
    expect(landingProductUrl('fire-marshal')).toBe('https://suite.weehs.org/equipment')
    expect(landingProductUrl('hecp')).toBe('https://suite.weehs.org/loto')
    expect(landingProductUrl('permit-to-work')).toBe('https://suite.weehs.org/permits')
    expect(landingProductUrl('iso-45001-auditor')).toBe('https://suite.weehs.org/audit')
    expect(landingProductUrl('hira')).toBe('https://suite.weehs.org/hira')
    expect(landingProductUrl('ohs-suite')).toBe('https://suite.weehs.org/login')
  })

  it('bounces an unauthenticated module visit onto /login?next= that prefix', () => {
    for (const product of LANDING_PRODUCTS.filter((p) => p.moduleKey)) {
      const prefix = landingOpenPath(product)
      expect(loginPathFor({ pathname: prefix, search: '' })).toBe(
        `/login?next=${encodeURIComponent(prefix)}`
      )
    }
  })

  it('documents the six-product map', () => {
    const docs = readFileSync(join(root, 'docs/APPS.md'), 'utf8')
    for (const product of LANDING_PRODUCTS) {
      expect(docs, product.name).toContain(product.name)
      expect(docs, landingOpenPath(product)).toContain(landingOpenPath(product))
    }
    expect(docs).toContain('/permits')
    expect(docs).toContain('/equipment')
  })
})
