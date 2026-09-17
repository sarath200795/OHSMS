import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/loto'

export default function App() {
  return <ModuleApp moduleKey="loto" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'loto' }, App)
