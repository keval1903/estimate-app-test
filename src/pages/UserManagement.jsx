import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { createClient } from '@supabase/supabase-js'

export default function UserManagement() {
  const navigate = useNavigate()
  const { role } = useAuth()
  
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // If not admin, redirect
    if (role && role !== 'ADMIN') {
      navigate('/')
      return
    }
    fetchUsers()
  }, [role, navigate])

  const fetchUsers = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .order('created_at', { ascending: false })
      
    if (!error && data) {
      setUsers(data)
    }
    setLoading(false)
  }

  const handleRoleChange = async (id, newRole) => {
    const { error } = await supabase
      .from('user_roles')
      .update({ role: newRole })
      .eq('id', id)
      
    if (!error) {
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u))
    } else {
      alert('Error updating role')
    }
  }

  const handleToggleStatus = async (id, currentStatus) => {
    const { error } = await supabase
      .from('user_roles')
      .update({ is_active: !currentStatus })
      .eq('id', id)
      
    if (!error) {
      setUsers(users.map(u => u.id === id ? { ...u, is_active: !currentStatus } : u))
    } else {
      alert('Error updating status')
    }
  }

  const handleResetPassword = async (id, username) => {
    const newPassword = window.prompt(`Enter new password for ${username} (min 6 chars):`)
    if (!newPassword) return
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters')
      return
    }

    const { error } = await supabase.rpc('admin_reset_password', {
      target_user_id: id,
      new_password: newPassword
    })

    if (error) {
      alert('Failed to reset password: ' + error.message)
    } else {
      alert('Password reset successfully!')
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!newUsername || !newPassword) return
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters')
      return
    }
    
    setCreating(true)
    
    // Create a secondary supabase client that does not persist session
    // This allows creating a user without logging out the current admin
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const adminClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    })

    const { data, error } = await adminClient.auth.signUp({
      email: `${newUsername}@estimateapp.local`,
      password: newPassword
    })

    if (error) {
      alert(`Error creating user: ${error.message}`)
    } else {
      alert('User created successfully! They can now log in.')
      setNewUsername('')
      setNewPassword('')
      // Give the database trigger a moment to run, then refresh
      setTimeout(fetchUsers, 1000)
    }
    
    setCreating(false)
  }

  if (loading && users.length === 0) return <div style={{ padding: 20 }}>Loading...</div>

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Back</button>
        <span className="nav-title" style={{ marginLeft: 8 }}>User Management</span>
        <div style={{ width: 60 }}></div>
      </div>
      
      <div className="page">
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Create New User</h3>
          <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 500 }}>Username</label>
              <input 
                type="text" 
                value={newUsername}
                onChange={e => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                className="input-field" 
                placeholder="e.g. sales1"
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 500 }}>Password</label>
              <input 
                type="text" 
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="input-field" 
                placeholder="Min 6 characters"
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating} style={{ height: 42 }}>
              {creating ? 'Creating...' : 'Create Staff'}
            </button>
          </form>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Note: New users are created as STAFF by default.
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="est-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Username</th>
                <th style={{ textAlign: 'center' }}>Role</th>
                <th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.username}</td>
                  <td style={{ textAlign: 'center' }}>
                    <select 
                      value={u.role} 
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      className="input-field"
                      style={{ padding: '4px 8px', width: 'auto', display: 'inline-block' }}
                    >
                      <option value="STAFF">STAFF</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button 
                        className="btn" 
                        onClick={() => handleResetPassword(u.id, u.username)}
                        style={{ 
                          padding: '4px 8px', 
                          fontSize: 12,
                          background: '#f1f5f9',
                          color: '#475569',
                          border: 'none'
                        }}
                      >
                        Reset Password
                      </button>
                      <button 
                        className="btn" 
                        onClick={() => handleToggleStatus(u.id, u.is_active)}
                        style={{ 
                          padding: '4px 8px', 
                          fontSize: 12,
                          background: u.is_active ? '#fee2e2' : '#dcfce7',
                          color: u.is_active ? '#dc2626' : '#16a34a',
                          border: 'none'
                        }}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
