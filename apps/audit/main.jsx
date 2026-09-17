import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/audit'

export default function App() {
  return <ModuleApp moduleKey="audit" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'audit' }, App)
