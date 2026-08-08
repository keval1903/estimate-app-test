import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

import { isFuzzyMatch } from '../lib/searchUtils'

export default function ClientSitesList() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    fetchClients()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  async function fetchClients() {
    setLoading(true)
    try {
      const { data: clientsData, error } = await supabase
        .from('clients')
        .select('id, name')
        
      if (error) throw error

      const { data: estData } = await supabase
        .from('estimates')
        .select('client_name')
        .is('client_id', null)

      const { data: sitesData } = await supabase
        .from('client_sites')
        .select('client_name')
        .is('client_id', null)

      const cmap = new Map()
      if (clientsData) {
        clientsData.forEach(c => cmap.set(c.name.trim().toUpperCase(), { id: c.id, name: c.name, isLedger: true, hasSite: false }))
      }
      if (sitesData) {
        sitesData.forEach(s => {
          if (s.client_name) {
            const name = s.client_name.trim().toUpperCase()
            if (cmap.has(name)) {
              cmap.get(name).hasSite = true
            } else {
              cmap.set(name, { id: encodeURIComponent(name), name: s.client_name, isLedger: false, hasSite: true })
            }
          }
        })
      }
      if (estData) {
        estData.forEach(e => {
          if (e.client_name) {
            const name = e.client_name.trim().toUpperCase()
            if (!cmap.has(name)) cmap.set(name, { id: encodeURIComponent(name), name: e.client_name, isLedger: false, hasSite: false })
          }
        })
      }

      const merged = Array.from(cmap.values()).sort((a, b) => a.name.localeCompare(b.name))
      setClients(merged)
    } catch (e) {
      alert('Error fetching clients: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = clients.filter(c => {
    const s = search.replace(/\s+/g, '')
    if (!s) {
      // Hide loose estimate names by default unless searched
      return c.isLedger || c.hasSite
    }
    return isFuzzyMatch(s, c.name)
  })

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

  async function handleClientClick(c) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(c.id)
    if (isUuid) {
      navigate(`/client-sites/${c.id}`)
    } else {
      navigate(`/client-sites/${encodeURIComponent(c.name)}`)
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
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered[selectedIndex]) {
                handleClientClick(filtered[selectedIndex])
              }
            }
          }}
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
          {filtered.map((c, index) => (
            <div 
              key={c.id} 
              className="card" 
              style={{ 
                marginBottom: '1rem', 
                cursor: 'pointer', 
                padding: '1rem', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                backgroundColor: index === selectedIndex ? '#f1f5f9' : 'white',
                border: index === selectedIndex ? '1px solid #cbd5e1' : '1px solid transparent'
              }}
              onClick={() => handleClientClick(c)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <h3 style={{ margin: '0', fontSize: '1.1rem' }}>{c.name} {/^[0-9a-fA-F-]{36}$/i.test(c.id) ? '' : <span style={{fontSize: '0.8rem', color: '#ef4444', marginLeft: '8px', fontWeight: 'normal'}}>(Not in Ledger)</span>}</h3>
              <span style={{ color: 'var(--text-light)' }}>→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
