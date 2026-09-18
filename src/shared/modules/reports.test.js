import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { OPERATING_APPS, appIndexPath } from './apps'
import {
  MODULE_REPORTS,
  MODULE_REPORTS_BY_KEY,
  REPORTS_SEGMENT,
  moduleReportsPath,
  reportsNavTab,
} from './reports'
import { pathIsOwned } from './ownership'
import { landingOpenPath, LANDING_PRODUCTS } from './landing'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const ROUTER = {
  incidents: 'src/modules/incidents/index.jsx',
  hira: 'src/modules/hira/index.jsx',
  inspections: 'src/modules/inspections/index.jsx',
  audit: 'src/modules/audit/index.jsx',
  ptw: 'src/modules/ptw/index.jsx',
  loto: 'src/modules/loto/index.jsx',
  equipment: 'src/modules/fire/index.jsx',
  drills: 'src/modules/fire/DrillsModule.jsx',
  committee: 'src/modules/committee/index.jsx',
  training: 'src/modules/training/index.jsx',
  documents: 'src/modules/documents/index.jsx',
  emergency: 'src/modules/emergency/index.jsx',
  objectives: 'src/modules/objectives/index.jsx',
  weather: 'src/modules/weather/index.jsx',
  cctv: 'src/modules/cctv/index.jsx',
  stakeholder: 'src/modules/stakeholder/index.jsx',
  actions: 'src/modules/actions/index.jsx',
}

describe('module reports contract', () => {
  it('gives every operating app exactly one reports path under its prefix', () => {
    expect(MODULE_REPORTS.map((r) => r.key).sort()).toEqual(OPERATING_APPS.map((a) => a.key).sort())
    for (const app of OPERATING_APPS) {
      const reports = MODULE_REPORTS_BY_KEY[app.key]
      expect(reports.pathPrefix).toBe(app.pathPrefix)
      expect(reports.reportsPath).toBe(`${app.pathPrefix}/${REPORTS_SEGMENT}`)
      expect(moduleReportsPath(app.pathPrefix)).toBe(reports.reportsPath)
      expect(reportsNavTab(app.pathPrefix)).toEqual({
        to: reports.reportsPath,
        label: 'Reports',
        end: true,
      })
    }
  })

  it('keeps reports on the module app, not the shell', () => {
    expect(pathIsOwned('/analytics', 'shell')).toBe(true)
    for (const reports of MODULE_REPORTS) {
      expect(pathIsOwned(reports.reportsPath, 'shell'), reports.reportsPath).toBe(false)
      expect(pathIsOwned(reports.reportsPath, 'module', reports.key), reports.reportsPath).toBe(
        true
      )
    }
  })

  it('rewrites each reports path to that module’s deployed app', () => {
    const json = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const rewrites = json.hosting.rewrites || []
    for (const reports of MODULE_REPORTS) {
      const splat = rewrites.find((r) => r.source === `${reports.pathPrefix}/**`)
      expect(splat?.destination, reports.reportsPath).toBe(appIndexPath(reports.key))
    }
  })

  it('mounts a reports route in every operating module router', () => {
    expect(Object.keys(ROUTER).sort()).toEqual(OPERATING_APPS.map((a) => a.key).sort())
    for (const app of OPERATING_APPS) {
      const rel = ROUTER[app.key]
      const file = join(root, rel)
      expect(existsSync(file), rel).toBe(true)
      const src = readFileSync(file, 'utf8')
      expect(src, rel).toContain('path="reports"')
      const hasLiteral = src.includes(moduleReportsPath(app.pathPrefix))
      const hasHelper =
        src.includes(`reportsNavTab('${app.pathPrefix}')`) ||
        src.includes(`reportsNavTab("${app.pathPrefix}")`)
      expect(hasLiteral || hasHelper, `${rel} reports path`).toBe(true)
    }
  })

  it('gives landing’s five module products a reports URL on the same app', () => {
    for (const product of LANDING_PRODUCTS.filter((p) => p.moduleKey)) {
      const prefix = landingOpenPath(product)
      const reportsPath = moduleReportsPath(prefix)
      expect(MODULE_REPORTS_BY_KEY[product.moduleKey].reportsPath).toBe(reportsPath)
      expect(pathIsOwned(reportsPath, 'module', product.moduleKey)).toBe(true)
    }
  })

  it('documents per-module apps, per-module reports, and the shared database', () => {
    const docs = readFileSync(join(root, 'docs/APPS.md'), 'utf8')
    expect(docs).toContain('one Vite app')
    expect(docs).toContain('no per-module database')
    expect(docs).toContain('<pathPrefix>/reports')
    expect(docs).toContain('/analytics')
    expect(docs).toContain('cross-suite rollup')
    expect(docs).toContain('/equipment/reports')
    expect(docs).toContain('/permits/reports')
    expect(docs).toContain('/hira/reports')
  })
})
