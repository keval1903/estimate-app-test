import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

import { isFuzzyMatch } from '../lib/searchUtils'
import { extractImageUrls, deleteImagesFromStorage } from '../lib/imageCleanup'

export default function ClientSitesView() {
  const navigate = useNavigate()
  const { clientId } = useParams()
  
  const [client, setClient] = useState(null)
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('ongoing') // 'ongoing' or 'completed'

  useEffect(() => {
    fetchClientAndSites()
  }, [clientId])

  async function fetchClientAndSites() {
    setLoading(true)
    try {
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(clientId)
      const decodedName = decodeURIComponent(clientId)

      if (isUuid) {
        const { data: cData, error: cErr } = await supabase.from('clients').select('name').eq('id', clientId).single()
        if (cErr) throw cErr
        setClient(cData)

        const { data: sData, error: sErr } = await supabase.from('client_sites').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
        if (sErr) throw sErr
        setSites(sData || [])
      } else {
        setClient({ name: decodedName })

        const { data: sData, error: sErr } = await supabase.from('client_sites').select('*').eq('client_name', decodedName).is('client_id', null).order('created_at', { ascending: false })
        if (sErr) throw sErr
        setSites(sData || [])
      }
    } catch (e) {
      alert('Error fetching data: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id, siteName) {
    if (!window.confirm(`Are you sure you want to delete ${siteName}?`)) return
    try {
      const siteToDelete = sites.find(s => s.id === id)

      const { error } = await supabase.from('client_sites').delete().eq('id', id)
      if (error) throw error
      
      if (siteToDelete && siteToDelete.details && siteToDelete.details.selectionSheetHtml) {
        const urls = extractImageUrls(siteToDelete.details.selectionSheetHtml)
        if (urls.length > 0) {
          await deleteImagesFromStorage(urls)
        }
      }

      setSites(sites.filter(s => s.id !== id))
    } catch (e) {
      alert('Error deleting site: ' + e.message)
    }
  }

  const filteredSites = sites.filter(s => {
    // Filter by tab
    const isCompleted = s.status === 'COMPLETED'
    if (activeTab === 'ongoing' && isCompleted) return false
    if (activeTab === 'completed' && !isCompleted) return false

    // Filter by search
    if (!search.trim()) return true
    const q = search.replace(/\s+/g, '')
    return isFuzzyMatch(q, s.site_name) || isFuzzyMatch(q, s.location) || isFuzzyMatch(q, s.party_name)
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

      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        <button
          onClick={() => setActiveTab('ongoing')}
          style={{
            flex: 1, padding: '1rem', border: 'none', background: 'transparent',
            fontWeight: activeTab === 'ongoing' ? 'bold' : 'normal',
            borderBottom: activeTab === 'ongoing' ? '3px solid var(--primary-color)' : '3px solid transparent',
            color: activeTab === 'ongoing' ? 'var(--primary-color)' : 'var(--text-light)',
            cursor: 'pointer'
          }}
        >
          Active Sites
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          style={{
            flex: 1, padding: '1rem', border: 'none', background: 'transparent',
            fontWeight: activeTab === 'completed' ? 'bold' : 'normal',
            borderBottom: activeTab === 'completed' ? '3px solid var(--primary-color)' : '3px solid transparent',
            color: activeTab === 'completed' ? 'var(--primary-color)' : 'var(--text-light)',
            cursor: 'pointer'
          }}
        >
          Completed Sites
        </button>
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
          {search ? 'No sites found matching your search.' : `No ${activeTab} sites found.`}
        </div>
      ) : (
        <div style={{ padding: '0 1rem' }}>
          {filteredSites.map(s => (
            <div 
              key={s.id} 
              className="card" 
              style={{ marginBottom: '1rem', cursor: 'pointer', padding: '1rem', borderLeft: s.status === 'COMPLETED' ? '4px solid #10b981' : 'none' }}
              onClick={() => navigate(`/client-sites/${clientId}/edit/${s.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', color: 'var(--primary-color)' }}>
                      {s.site_name}
                    </h3>
                    {s.status === 'COMPLETED' && (
                      <span style={{ fontSize: '0.7rem', background: '#10b981', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        COMPLETED
                      </span>
                    )}
                  </div>
                  {s.party_name && <div style={{ fontSize: '0.9rem' }}><strong>Party:</strong> {s.party_name}</div>}
                  {s.location && <div style={{ fontSize: '0.9rem' }}><strong>Location:</strong> {s.location}</div>}
                  {s.carpenter && <div style={{ fontSize: '0.9rem' }}><strong>Carpenter:</strong> {s.carpenter} {s.carpenter_phone ? `(${s.carpenter_phone})` : ''}</div>}
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginTop: '0.5rem' }}>
                    {s.status === 'COMPLETED' && s.end_date ? `Completed: ${new Date(s.end_date).toLocaleDateString()}` : `Started: ${s.start_date ? new Date(s.start_date).toLocaleDateString() : new Date(s.created_at).toLocaleDateString()}`}
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
