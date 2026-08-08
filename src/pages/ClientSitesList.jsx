import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

import { isFuzzyMatch } from '../lib/searchUtils'

export default function ClientSitesList() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchClients()
  }, [])

  async function fetchClients() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .order('name', { ascending: true })
      if (error) throw error
      setClients(data || [])
    } catch (e) {
      alert('Error fetching clients: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = clients.filter(c => isFuzzyMatch(search.replace(/\s+/g, ''), c.name))

  async function handleQuickAddClient() {
    const name = window.prompt("Enter new client name:")
    if (!name || !name.trim()) return
    
    setLoading(true)
    try {
      const payload = {
        name: name.trim().toUpperCase(),
        opening_balance: 0
      }
      const { data, error } = await supabase.from('clients').insert([payload]).select().single()
      if (error) throw error
      
      // Navigate straight to the new client's site page
      navigate(`/client-sites/${data.id}`)
    } catch (e) {
      alert('Error creating client: ' + e.message)
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ paddingBottom: '80px' }}>
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">Select Client for Site</span>
      </div>

      <div style={{ padding: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <input
          type="text"
          className="input"
          placeholder="Search client name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '150px', padding: '0.8rem 1rem', fontSize: '1rem' }}
        />
        <button className="btn btn-primary" onClick={handleQuickAddClient}>
          + New Client
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
          No clients found matching your search.
        </div>
      ) : (
        <div style={{ padding: '0 1rem' }}>
          {filtered.map(c => (
            <div 
              key={c.id} 
              className="card" 
              style={{ marginBottom: '1rem', cursor: 'pointer', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => navigate(`/client-sites/${c.id}`)}
            >
              <h3 style={{ margin: '0', fontSize: '1.1rem' }}>{c.name}</h3>
              <span style={{ color: 'var(--text-light)' }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
