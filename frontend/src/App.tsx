import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import ManagerPage from './features/manager/ManagerPage'
import ViewerPage from './features/viewer/ViewerPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/manager" replace />} />
        <Route path="/manager" element={<ManagerPage />} />
        <Route path="/viewer/:sessionId" element={<ViewerPage />} />
        <Route path="/viewer/group/:groupId" element={<ViewerPage />} />
      </Routes>
    </HashRouter>
  )
}
