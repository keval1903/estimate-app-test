import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

import { isFuzzyMatch } from '../lib/searchUtils'

export default function ClientSitesView() {
  const navigate = useNavigate()
  const { clientId } = useParams()
  
  const [client, setClient] = useState(null)
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchClientAndSites()
  }, [clientId])

  async function fetchClientAndSites() {
    setLoading(true)
    try {
      // Fetch Client
      const { data: clientData, error: clientErr } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single()
      if (clientErr) throw clientErr
      setClient(clientData)

      // Fetch Sites
      const { data: sitesData, error: sitesErr } = await supabase
        .from('client_sites')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (sitesErr) throw sitesErr
      setSites(sitesData || [])

    } catch (e) {
      alert('Error fetching data: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id, siteName) {
    if (!window.confirm(`Are you sure you want to delete ${siteName}?`)) return
    try {
      const { error } = await supabase.from('client_sites').delete().eq('id', id)
      if (error) throw error
      setSites(sites.filter(s => s.id !== id))
    } catch (e) {
      alert('Error deleting site: ' + e.message)
    }
  }

  const filteredSites = sites.filter(s => {
    const q = search.replace(/\s+/g, '')
    return isFuzzyMatch(q, s.site_name) || isFuzzyMatch(q, s.society_name)
  })

  return (
    <div className="container" style={{ paddingBottom: '80px' }}>
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {client ? `${client.name}'s Sites` : 'Client Sites'}
        </span>
      </div>

      <div style={{ padding: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <input
          type="text"
          className="input"
          placeholder="Search sites..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '150px', padding: '0.8rem 1rem', fontSize: '1rem' }}
        />
        <button className="btn btn-primary" onClick={() => navigate(`/client-sites/${clientId}/edit/new`)}>
          + Add New
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>
      ) : filteredSites.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
          No sites found.
        </div>
      ) : (
        <div style={{ padding: '0 1rem' }}>
          {filteredSites.map(s => (
            <div 
              key={s.id} 
              className="card" 
              style={{ marginBottom: '1rem', cursor: 'pointer', padding: '1rem' }}
              onClick={() => navigate(`/client-sites/${clientId}/edit/${s.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', color: 'var(--primary-color)' }}>
                    {s.site_name}
                  </h3>
                  {s.society_name && <div style={{ fontSize: '0.9rem' }}><strong>Society:</strong> {s.society_name}</div>}
                  {s.flat_no && <div style={{ fontSize: '0.9rem' }}><strong>Flat No:</strong> {s.flat_no}</div>}
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
                    Added: {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button 
                  className="btn btn-ghost" 
                  style={{ color: 'var(--danger-color)', padding: '0.5rem' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(s.id, s.site_name);
                  }}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
