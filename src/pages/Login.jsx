import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

import { setSessionExpiry } from '../lib/sessionExpiry'

export default function Login() {
  const navigate = useNavigate()
  const { user } = useAuth()
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // If user is already logged in, redirect them immediately
  if (user) {
    navigate('/', { replace: true })
    return null
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    
    // Simulate username login by trying @estimateapp.local first (for older users)
    const emailLocal = `${username}@estimateapp.local`
    
    // Set flag so AuthContext waits for us to finish DB updates before checking the token
    localStorage.setItem('login_in_progress', 'true')
    
    let { data, error } = await supabase.auth.signInWithPassword({
      email: emailLocal,
      password,
    })

    // If it fails with invalid credentials, it might be a newer user with @estimateapp.com
    if (error && error.message.includes('Invalid login credentials')) {
      const emailCom = `${username}@estimateapp.com`
      const retry = await supabase.auth.signInWithPassword({
        email: emailCom,
        password,
      })
      data = retry.data
      error = retry.error
    }

    if (error) {
      localStorage.removeItem('login_in_progress')
      setError(error.message)
      setLoading(false)
    } else {
      await setSessionExpiry()
      
      // Enforce single session
      const newToken = Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('active_session_token', newToken)
      if (data?.user?.id) {
        const { error: rpcErr } = await supabase.rpc('update_my_session_token', { new_token: newToken })
        if (rpcErr) {
          console.warn('RPC failed, falling back to direct update:', rpcErr.message)
          // Fallback for Admins who bypass RLS
          const { error: fbErr } = await supabase.from('user_roles').update({ current_session_token: newToken }).eq('id', data.user.id)
          if (fbErr) {
            alert('Database error updating session token. Please ensure you ran fix_session_rpc.sql. Error: ' + fbErr.message)
          }
        }
      }
      
      localStorage.removeItem('login_in_progress')
      navigate('/', { replace: true })
    }
  }

  return (
    <div style={{
      display: 'flex', 
      height: '100vh', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundColor: '#f9fafb'
    }}>
      <div style={{
        background: 'white',
        padding: '2rem',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 'bold' }}>Sign In</h2>
        
        {error && (
          <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label htmlFor="username" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '500' }}>Username</label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                outline: 'none'
              }}
              placeholder="admin"
            />
          </div>
          <div>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: '500' }}>Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                outline: 'none'
              }}
              placeholder="••••••••"
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              backgroundColor: '#4f46e5',
              color: 'white',
              padding: '0.75rem',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Processing...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

