import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/training'

export default function App() {
  return <ModuleApp moduleKey="training" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'training' }, App)
