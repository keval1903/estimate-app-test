import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const DEFAULT_DYNAMIC_FIELDS = [
  'Fabric', 'Ply', 'Bed 1', 'Bed 2', 'Bed 3', 'Bed 4', 
  'Living', 'Kitchen', 'TV Unit', 'Shoe Rack', 'Main Door', 
  'Other', 'Auto Hinges', 'Channel', 'Handle'
]

const DetailItem = ({ label, value }) => {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontWeight: '500' }}>{value}</div>
    </div>
  )
}

export default function SiteDetailsEditor() {
  const navigate = useNavigate()
  const { clientId, siteId } = useParams()
  
  const [loading, setLoading] = useState(siteId !== 'new')
  const [saving, setSaving] = useState(false)
  const [client, setClient] = useState(null)
  const [isEditing, setIsEditing] = useState(siteId === 'new')

  const [siteData, setSiteData] = useState({
    site_name: '',
    society_name: '',
    flat_no: '',
    area: '',
    carpenter: '',
    start_date: '',
    end_date: '',
  })
  
  const [details, setDetails] = useState({})
  const [newFieldName, setNewFieldName] = useState('')

  useEffect(() => {
    fetchData()
  }, [clientId, siteId])

  async function fetchData() {
    try {
      const { data: clientData } = await supabase.from('clients').select('name').eq('id', clientId).single()
      if (clientData) setClient(clientData)

      if (siteId === 'new') {
        const initialDetails = {}
        DEFAULT_DYNAMIC_FIELDS.forEach(f => initialDetails[f] = '')
        setDetails(initialDetails)
        return
      }

      const { data, error } = await supabase.from('client_sites').select('*').eq('id', siteId).single()
      if (error) throw error
      
      setSiteData({
        site_name: data.site_name || '',
        society_name: data.society_name || '',
        flat_no: data.flat_no || '',
        area: data.area || '',
        carpenter: data.carpenter || '',
        start_date: data.start_date || '',
        end_date: data.end_date || '',
      })
      
      const savedDetails = data.details || {}
      const mergedDetails = { ...savedDetails }
      DEFAULT_DYNAMIC_FIELDS.forEach(f => {
        if (mergedDetails[f] === undefined) mergedDetails[f] = ''
      })
      setDetails(mergedDetails)

    } catch (e) {
      alert('Error fetching data: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDetailChange = (key, val) => {
    setDetails(prev => ({ ...prev, [key]: val }))
  }

  const handleAddCustomField = () => {
    const key = newFieldName.trim()
    if (!key) return
    if (details[key] !== undefined) {
      alert('Field already exists!')
      return
    }
    setDetails(prev => ({ ...prev, [key]: '' }))
    setNewFieldName('')
  }

  async function handleSave() {
    if (!siteData.site_name.trim()) {
      alert('Please enter a Site Title/Name (e.g. "Main Flat").')
      return
    }
    setSaving(true)
    
    // Use null for empty dates so postgres doesn't throw invalid input syntax for type date error
    const payload = {
      client_id: clientId,
      site_name: siteData.site_name,
      society_name: siteData.society_name,
      flat_no: siteData.flat_no,
      area: siteData.area,
      carpenter: siteData.carpenter,
      start_date: siteData.start_date || null,
      end_date: siteData.end_date || null,
      details
    }

    try {
      if (siteId === 'new') {
        const { error } = await supabase.from('client_sites').insert(payload)
        if (error) throw error
        navigate(-1)
      } else {
        const { error } = await supabase.from('client_sites').update({
          ...payload,
          updated_at: new Date().toISOString()
        }).eq('id', siteId)
        if (error) throw error
        setIsEditing(false)
      }
    } catch (e) {
      alert('Error saving site: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      // Only handle enter for inputs with nav-input class
      if (e.target.classList.contains('nav-input')) {
        e.preventDefault()
        const inputs = Array.from(document.querySelectorAll('.nav-input'))
        const index = inputs.indexOf(e.target)
        if (index > -1) {
          if (index < inputs.length - 1) {
            inputs[index + 1].focus()
          } else {
            handleSave()
          }
        }
      }
    }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>

  return (
    <div className="container" style={{ paddingBottom: '80px' }}>
      <div className="top-nav" style={{ flexShrink: 0 }}>
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {siteId === 'new' ? 'New Site' : (isEditing ? 'Edit Site' : 'Site Details')}
        </span>
        
        {isEditing ? (
          <button 
            className="btn btn-primary" 
            onClick={handleSave} 
            disabled={saving}
            style={{ marginLeft: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.9rem' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        ) : (
          <button 
            className="btn btn-secondary" 
            onClick={() => setIsEditing(true)} 
            style={{ marginLeft: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.9rem' }}
          >
            ✏️ Edit
          </button>
        )}
      </div>

      {!isEditing ? (
        // --- VIEW MODE ---
        <div style={{ padding: '1rem' }}>
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: '0 0 1rem 0', color: 'var(--primary-color)' }}>
              {client ? client.name : 'Client'} - {siteData.site_name}
            </h2>
            
            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <DetailItem label="Society Name" value={siteData.society_name} />
              <DetailItem label="Flat No" value={siteData.flat_no} />
              <DetailItem label="Area" value={siteData.area} />
              <DetailItem label="Carpenter" value={siteData.carpenter} />
              <DetailItem label="Site Started" value={siteData.start_date ? new Date(siteData.start_date).toLocaleDateString() : ''} />
              <DetailItem label="Site End" value={siteData.end_date ? new Date(siteData.end_date).toLocaleDateString() : ''} />
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 1rem 0', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', color: 'var(--text-color)' }}>
              Material & Room Details
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {Object.entries(details).filter(([_, val]) => val.trim() !== '').map(([key, val]) => (
                <div key={key} style={{ display: 'flex', padding: '0.75rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                  <div style={{ flex: '0 0 140px', fontWeight: 'bold', color: 'var(--text-light)' }}>{key}</div>
                  <div style={{ flex: 1 }}>{val}</div>
                </div>
              ))}
              {Object.entries(details).filter(([_, val]) => val.trim() !== '').length === 0 && (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-light)', fontStyle: 'italic', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
                  No material details added yet. Click Edit to add some!
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // --- EDIT MODE ---
        <div style={{ padding: '1rem' }} onKeyDown={handleKeyDown}>
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: '0 0 1rem 0', color: 'var(--primary-color)' }}>
              {client ? client.name : 'Client'}
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Site Title *</label>
                <input
                  type="text"
                  className="input nav-input"
                  placeholder="e.g. Office..."
                  value={siteData.site_name}
                  onChange={e => setSiteData({...siteData, site_name: e.target.value})}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Name of Society</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.society_name}
                  onChange={e => setSiteData({...siteData, society_name: e.target.value})}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Flat No</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.flat_no}
                  onChange={e => setSiteData({...siteData, flat_no: e.target.value})}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Area</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.area}
                  onChange={e => setSiteData({...siteData, area: e.target.value})}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Carpenter</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.carpenter}
                  onChange={e => setSiteData({...siteData, carpenter: e.target.value})}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Site Started</label>
                <input
                  type="date"
                  className="input nav-input"
                  value={siteData.start_date}
                  onChange={e => setSiteData({...siteData, start_date: e.target.value})}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Site End</label>
                <input
                  type="date"
                  className="input nav-input"
                  value={siteData.end_date}
                  onChange={e => setSiteData({...siteData, end_date: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-color)' }}>Material & Room Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              {Object.entries(details).map(([key, val]) => (
                <div key={key}>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-light)' }}>{key}</label>
                  <input
                    type="text"
                    className="input nav-input"
                    value={val}
                    onChange={e => handleDetailChange(key, e.target.value)}
                    placeholder={`${key}...`}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-color)' }}>Add Custom Field</h4>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Balcony"
                  value={newFieldName}
                  onChange={e => setNewFieldName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustomField()}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-secondary" onClick={handleAddCustomField}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
