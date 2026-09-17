import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/fire/DrillsModule'

export default function App() {
  return <ModuleApp moduleKey="drills" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'drills' }, App)
