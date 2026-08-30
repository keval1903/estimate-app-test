import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Home from './pages/Home'
import Products from './pages/Products'
import EstimateList from './pages/EstimateList'
import CreateEstimate from './pages/CreateEstimate'
import EstimateView from './pages/EstimateView'
import StockReport from './pages/StockReport'
import Clients from './pages/Clients'
import ClientLedger from './pages/ClientLedger'
import UserManagement from './pages/UserManagement'
import SalesReport from './pages/SalesReport'
import SelectionSheetList from './pages/SelectionSheetList'
import SelectionSheetEditor from './pages/SelectionSheetEditor'
import Catalogue from './pages/Catalogue'

import ClientSitesList from './pages/ClientSitesList'
import ClientSitesView from './pages/ClientSitesView'
import SiteDetailsEditor from './pages/SiteDetailsEditor'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
          <Route path="/estimates" element={<ProtectedRoute><EstimateList /></ProtectedRoute>} />
          <Route path="/estimate/new" element={<ProtectedRoute><CreateEstimate /></ProtectedRoute>} />
          <Route path="/estimate/edit/:id" element={<ProtectedRoute><CreateEstimate /></ProtectedRoute>} />
          <Route path="/estimate/view/:id" element={<ProtectedRoute><EstimateView /></ProtectedRoute>} />
          <Route path="/stock-report" element={<ProtectedRoute><StockReport /></ProtectedRoute>} />
          <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
          <Route path="/clients/:id" element={<ProtectedRoute><ClientLedger /></ProtectedRoute>} />
          <Route path="/client-sites" element={<ProtectedRoute><ClientSitesList /></ProtectedRoute>} />
          <Route path="/client-sites/:clientId" element={<ProtectedRoute><ClientSitesView /></ProtectedRoute>} />
          <Route path="/client-sites/:clientId/edit/:siteId" element={<ProtectedRoute><SiteDetailsEditor /></ProtectedRoute>} />
          <Route path="/selection-sheets" element={<ProtectedRoute><SelectionSheetList /></ProtectedRoute>} />
          <Route path="/selection-sheets/:id" element={<ProtectedRoute><SelectionSheetEditor /></ProtectedRoute>} />
          <Route path="/catalogue" element={<ProtectedRoute><Catalogue /></ProtectedRoute>} />
          <Route path="/sales-report" element={<ProtectedRoute><SalesReport /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
