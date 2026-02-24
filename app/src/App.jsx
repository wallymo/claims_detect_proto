import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from '@/pages/Home'
import MKGClaimsDetector from '@/pages/MKGClaimsDetector'
import MKG2ClaimsDetector from '@/pages/MKG2ClaimsDetector'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/mkg2" replace />} />
        <Route path="/demo" element={<Home />} />
        <Route path="/mkg" element={<MKGClaimsDetector />} />
        <Route path="/mkg2" element={<MKG2ClaimsDetector />} />
      </Routes>
    </BrowserRouter>
  )
}
