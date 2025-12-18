import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from '@/pages/Home'
import MKGClaimsDetector from '@/pages/MKGClaimsDetector'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mkg" element={<MKGClaimsDetector />} />
      </Routes>
    </BrowserRouter>
  )
}
