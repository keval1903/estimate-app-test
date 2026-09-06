import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function ChoosePlatform() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const platforms = [
    { id: 'ccai', name: 'CCAI', color: '#3b82f6' },
    { id: 'dc', name: 'DC', color: '#10b981' },
    { id: 'materia', name: 'Materia', color: '#f59e0b' },
    { id: 'phs', name: 'PHS', color: '#ef4444' }
  ]

  async function handleLogout() {
    await supabase.auth.signOut()
    localStorage.removeItem('active_session_token')
    navigate('/login')
  }

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Welcome, {user?.email?.split('@')[0] || 'User'}</h2>
        <button className="btn btn-ghost" onClick={handleLogout}>Logout</button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Select Platform</h1>
        <p style={{ color: 'var(--text-muted)' }}>Choose a division to manage estimates and stock.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        {platforms.map(p => (
          <div 
            key={p.id}
            onClick={() => navigate(`/${p.id}`)}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-light)',
              borderRadius: '12px',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 8px 15px ${p.color}40` }}
            onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)' }}
          >
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: `${p.color}20`, color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto', fontSize: '1.5rem', fontWeight: 'bold' }}>
              {p.name.charAt(0)}
            </div>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{p.name}</h3>
          </div>
        ))}
      </div>
    </div>
  )
}
