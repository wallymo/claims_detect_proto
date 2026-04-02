import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from '@/pages/Home'
import MKGClaimsDetector from '@/pages/MKGClaimsDetector'
import MKG2ClaimsDetector from '@/pages/MKG2ClaimsDetector'
import MKG3ClaimsDetector from '@/pages/MKG3ClaimsDetector'
import ValidationReport from '@/pages/ValidationReport'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/mkg3" replace />} />
        <Route path="/demo" element={<Home />} />
        <Route path="/mkg" element={<MKGClaimsDetector />} />
        <Route path="/mkg2" element={<MKG2ClaimsDetector />} />
        <Route path="/mkg3" element={<MKG3ClaimsDetector />} />
        <Route path="/validation" element={<ValidationReport />} />
      </Routes>
    </BrowserRouter>
  )
}
