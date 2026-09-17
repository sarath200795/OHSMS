import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/cctv'

export default function App() {
  return <ModuleApp moduleKey="cctv" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'cctv' }, App)
