import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const [connOk, setConnOk] = useState(null)
  const [lowStockCount, setLowStockCount] = useState(0)

  useEffect(() => {
    supabase.from('products').select('id', { count: 'exact', head: true })
      .then(({ error }) => setConnOk(!error))

    // Fetch low stock items count
    supabase.from('products').select('stock, min_stock, has_stock')
      .eq('has_stock', true)
      .then(({ data }) => {
        if (data) {
          const count = data.filter(p => Number(p.stock || 0) < Number(p.min_stock ?? 5)).length
          setLowStockCount(count)
        }
      })
  }, [])

  return (
    <div className="app-container">
      <div className="top-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="nav-title">📋 CCAI Estimate App</span>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {connOk !== null && (
            <span className={`conn-status ${connOk ? 'conn-ok' : 'conn-err'}`}>
              {connOk ? '● Live' : '● Offline'}
            </span>
          )}
          <button
            onClick={async () => await supabase.auth.signOut()}
            style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="page">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>
            Welcome back
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>What would you like to do?</div>
        </div>

        <button className="home-btn" onClick={() => navigate('/estimate/new')}>
          <div className="home-btn-icon" style={{ background: '#e8f5ec' }}>📝</div>
          <div>
            <div className="home-btn-text">CREATE NEW QUOTATION / ESTIMATE</div>
            <div className="home-btn-sub">Start a quote or direct bill for a site</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/estimate/new?type=RETURN')}>
          <div className="home-btn-icon" style={{ background: '#fee2e2' }}>↩️</div>
          <div>
            <div className="home-btn-text">CREATE NEW SALES RETURN</div>
            <div className="home-btn-sub">Log returned items and issue a credit note</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/products')}>
          <div className="home-btn-icon" style={{ background: '#dbeafe' }}>📦</div>
          <div>
            <div className="home-btn-text">PRODUCT MASTER</div>
            <div className="home-btn-sub">Add, edit or update product rates & stock</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/clients')}>
          <div className="home-btn-icon" style={{ background: '#e0e7ff' }}>👥</div>
          <div>
            <div className="home-btn-text">CLIENTS & LEDGER</div>
            <div className="home-btn-sub">Manage client profiles, payments & balances</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/stock-report?tab=reorder')}>
          <div className="home-btn-icon" style={{ background: '#fee2e2' }}>⚠️</div>
          <div>
            <div className="home-btn-text">
              LOW STOCK ALERTS {lowStockCount > 0 ? `(${lowStockCount})` : ''}
            </div>
            <div className="home-btn-sub">
              {lowStockCount > 0 ? `${lowStockCount} items below minimum stock level` : 'View items below minimum stock level'}
            </div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/estimates?tab=quotations')}>
          <div className="home-btn-icon" style={{ background: '#fce7f3' }}>📜</div>
          <div>
            <div className="home-btn-text">PREVIOUS QUOTATIONS</div>
            <div className="home-btn-sub">View quotes or convert them to estimates</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/estimates?tab=estimates')}>
          <div className="home-btn-icon" style={{ background: '#fef3c7' }}>🗂️</div>
          <div>
            <div className="home-btn-text">PREVIOUS ESTIMATES</div>
            <div className="home-btn-sub">View, edit or reprint old bills</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/estimates?tab=returns')}>
          <div className="home-btn-icon" style={{ background: '#fee2e2' }}>↩️</div>
          <div>
            <div className="home-btn-text">PREVIOUS SALE RETURNS</div>
            <div className="home-btn-sub">View, edit or reprint sales returns</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/stock-report')}>
          <div className="home-btn-icon" style={{ background: '#ecfdf5' }}>📊</div>
          <div>
            <div className="home-btn-text">STOCK MOVEMENT REPORT</div>
            <div className="home-btn-sub">View pieces added, sold & stock audit log</div>
          </div>
        </button>

        <button className="home-btn" onClick={() => navigate('/sales-report')}>
          <div className="home-btn-icon" style={{ background: '#fef08a' }}>📈</div>
          <div>
            <div className="home-btn-text">SALES REPORT</div>
            <div className="home-btn-sub">View product group sales by client</div>
          </div>
        </button>

        {role === 'ADMIN' && (
          <button className="home-btn" onClick={() => navigate('/users')}>
            <div className="home-btn-icon" style={{ background: '#f3e8ff' }}>🛡️</div>
            <div>
              <div className="home-btn-text">USER MANAGEMENT</div>
              <div className="home-btn-sub">Add staff accounts and manage roles</div>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
