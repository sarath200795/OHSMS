import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/actions'

export default function App() {
  return <ModuleApp moduleKey="actions" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'actions' }, App)
