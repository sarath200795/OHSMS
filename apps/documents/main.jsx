import { mountApp } from '../../src/app/bootstrap.jsx'
import ModuleApp from '../../src/app/ModuleApp.jsx'
import Page from '../../src/modules/documents'

export default function App() {
  return <ModuleApp moduleKey="documents" Page={Page} />
}

mountApp({ role: 'module', moduleKey: 'documents' }, App)
