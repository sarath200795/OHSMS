import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/inspections'

export default function App() {
  return <ModuleApp moduleKey="inspections" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'inspections' }, App)
