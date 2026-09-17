#!/usr/bin/env node
// Generate apps/<key>/{index.html,main.jsx} from OPERATING_APPS.
// Run from the repo root. Idempotent.
import { mkdirSync, writeFileSync } from 'node:fs'
import { OPERATING_APPS } from '../src/shared/modules/apps.js'

const HTML = (title) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/wehs.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#c74a33" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.jsx"></script>
  </body>
</html>
`

const SOURCE = {
  incidents: 'incidents',
  hira: 'hira',
  inspections: 'inspections',
  audit: 'audit',
  ptw: 'ptw',
  loto: 'loto',
  equipment: 'fire',
  drills: 'fire/DrillsModule',
  committee: 'committee',
  training: 'training',
  documents: 'documents',
  emergency: 'emergency',
  objectives: 'objectives',
  weather: 'weather',
  cctv: 'cctv',
  stakeholder: 'stakeholder',
  actions: 'actions',
}

const TITLES = Object.fromEntries(OPERATING_APPS.map((a) => [a.key, a.key]))

function moduleMain(key) {
  const source = SOURCE[key]
  return `import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/${source}'

export default function App() {
  return <ModuleApp moduleKey="${key}" Page={Page} />
}

mountApp({ role: 'module', moduleKey: '${key}' }, App)
`
}

mkdirSync('apps/shell', { recursive: true })
writeFileSync('apps/shell/index.html', HTML('WEHS — Workplace Environment, Health &amp; Safety'))
writeFileSync(
  'apps/shell/main.jsx',
  `import { mountApp } from '../../src/app/bootstrap.jsx'
import App from '../../src/App'

mountApp({ role: 'shell' }, App)
`
)

for (const app of OPERATING_APPS) {
  mkdirSync(`apps/${app.key}`, { recursive: true })
  writeFileSync(`apps/${app.key}/index.html`, HTML(`WEHS — ${TITLES[app.key]}`))
  writeFileSync(`apps/${app.key}/main.jsx`, moduleMain(app.key))
}

console.log(`Wrote apps/shell and ${OPERATING_APPS.length} module apps.`)
