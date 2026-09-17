import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/weather'

export default function App() {
  return <ModuleApp moduleKey="weather" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'weather' }, App)
