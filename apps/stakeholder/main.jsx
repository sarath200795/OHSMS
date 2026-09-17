import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/stakeholder'

export default function App() {
  return <ModuleApp moduleKey="stakeholder" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'stakeholder' }, App)
