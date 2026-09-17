import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/hira'

export default function App() {
  return <ModuleApp moduleKey="hira" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'hira' }, App)
