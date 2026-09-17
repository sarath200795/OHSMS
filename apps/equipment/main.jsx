import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/fire'

export default function App() {
  return <ModuleApp moduleKey="equipment" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'equipment' }, App)
