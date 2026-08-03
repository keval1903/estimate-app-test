import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

import Login from './pages/Login'
import Home from './pages/Home'

const Products = lazy(() => import('./pages/Products'))
const EstimateList = lazy(() => import('./pages/EstimateList'))
const CreateEstimate = lazy(() => import('./pages/CreateEstimate'))
const EstimateView = lazy(() => import('./pages/EstimateView'))
const StockReport = lazy(() => import('./pages/StockReport'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientLedger = lazy(() => import('./pages/ClientLedger'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const SalesReport = lazy(() => import('./pages/SalesReport'))

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '20px auto' }} />Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '20px auto' }} />Loading...</div>}>
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
            <Route path="/sales-report" element={<ProtectedRoute><SalesReport /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
