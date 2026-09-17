import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/objectives'

export default function App() {
  return <ModuleApp moduleKey="objectives" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'objectives' }, App)
