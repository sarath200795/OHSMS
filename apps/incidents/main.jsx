import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/incidents'

export default function App() {
  return <ModuleApp moduleKey="incidents" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'incidents' }, App)
