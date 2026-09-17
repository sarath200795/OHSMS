import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/committee'

export default function App() {
  return <ModuleApp moduleKey="committee" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'committee' }, App)
