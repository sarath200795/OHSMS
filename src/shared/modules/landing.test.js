import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OPERATING_APPS } from './apps'
import {
  AUTH_AUTHORIZED_HOSTS,
  LANDING_ENTRY_PATHS,
  LANDING_ENTRY_ROUTES,
  PUBLIC_SHELL_ORIGIN,
  landingHandoffUrl,
} from './landing'
import { pathIsOwned } from './ownership'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('landing handoff contract', () => {
  it('names the three paths weehs-landing opens, and no others', () => {
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
