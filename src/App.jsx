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
import LamineaCodes from './pages/LamineaCodes'
import ChoosePlatform from './pages/ChoosePlatform'
import { PlatformProvider } from './context/PlatformContext'

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
          <Route path="/choose-platform" element={<ProtectedRoute><ChoosePlatform /></ProtectedRoute>} />
          
          <Route path="/:platform" element={<ProtectedRoute><PlatformProvider /></ProtectedRoute>}>
            <Route index element={<Home />} />
            <Route path="products" element={<Products />} />
            <Route path="estimates" element={<EstimateList />} />
            <Route path="estimate/new" element={<CreateEstimate />} />
            <Route path="estimate/edit/:id" element={<CreateEstimate />} />
            <Route path="estimate/view/:id" element={<EstimateView />} />
            <Route path="stock-report" element={<StockReport />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientLedger />} />
            <Route path="client-sites" element={<ClientSitesList />} />
            <Route path="client-sites/:clientId" element={<ClientSitesView />} />
            <Route path="client-sites/:clientId/edit/:siteId" element={<SiteDetailsEditor />} />
            <Route path="selection-sheets" element={<SelectionSheetList />} />
            <Route path="selection-sheets/:id" element={<SelectionSheetEditor />} />
            <Route path="catalogue" element={<Catalogue />} />
            <Route path="alternative-codes" element={<LamineaCodes />} />
            <Route path="sales-report" element={<SalesReport />} />
            <Route path="users" element={<UserManagement />} />
          </Route>
          
          <Route path="/" element={<Navigate to="/choose-platform" replace />} />
          <Route path="*" element={<Navigate to="/choose-platform" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
