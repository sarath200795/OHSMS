import { Route, Routes } from 'react-router-dom'
import FieldHome from './FieldHome'
import FieldTasks from './FieldTasks'
import Scan from './Scan'
import Asset from './Asset'

export default function Field() {
  return (
    <Routes>
      <Route index element={<FieldHome />} />
      <Route path="tasks" element={<FieldTasks />} />
      <Route path="scan" element={<Scan />} />
      <Route path="asset/:token" element={<Asset />} />
    </Routes>
  )
}
