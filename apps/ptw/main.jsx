import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/ptw'

export default function App() {
  return <ModuleApp moduleKey="ptw" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'ptw' }, App)
