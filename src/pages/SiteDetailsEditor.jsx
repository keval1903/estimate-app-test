import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SelectionSheetTab from '../components/SelectionSheetTab'
import { cleanupRemovedImages } from '../lib/imageCleanup'

const DEFAULT_DYNAMIC_FIELDS = [
  'Ply Grade', 'Inner Laminate', 'Hardware'
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
    party_name: '',
    location: '',
    carpenter: '',
    carpenter_phone: '',
    start_date: '',
    end_date: '',
    status: 'ONGOING'
  })

  const [activeTab, setActiveTab] = useState('details') // 'details' or 'selection_sheet'

  const [details, setDetails] = useState({})
  const [initialSelectionSheetHtml, setInitialSelectionSheetHtml] = useState('')
  const [newFieldName, setNewFieldName] = useState('')

  const [isDraftRestored, setIsDraftRestored] = useState(false)
  const skipAutoSaveRef = useRef(false)
  const draftKey = siteId === 'new' ? 'site_draft_new' : `site_draft_${siteId}`

  useEffect(() => {
    fetchData()
  }, [clientId, siteId])

  async function fetchData() {
    try {
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(clientId)
      const decodedName = decodeURIComponent(clientId)

      if (isUuid) {
        const { data: clientData } = await supabase.from('clients').select('name').eq('id', clientId).single()
        if (clientData) setClient(clientData)
      } else {
        setClient({ name: decodedName })
      }

      if (siteId === 'new') {
        const initialDetails = {}
        DEFAULT_DYNAMIC_FIELDS.forEach(f => initialDetails[f] = '')
        setDetails(initialDetails)

        const savedDraft = localStorage.getItem(draftKey)
        if (savedDraft) {
          try {
            const parsed = JSON.parse(savedDraft)
            if (parsed.siteData) setSiteData(parsed.siteData)
            if (parsed.details) setDetails(parsed.details)
            setIsDraftRestored(true)
          } catch (e) { }
        }
        return
      }

      const { data, error } = await supabase.from('client_sites').select('*').eq('id', siteId).single()
      if (error) throw error

      setSiteData({
        site_name: data.site_name || '',
        party_name: data.party_name || '',
        location: data.location || '',
        carpenter: data.carpenter || '',
        carpenter_phone: data.carpenter_phone || '',
        start_date: data.start_date || '',
        end_date: data.end_date || '',
        status: data.status || 'ONGOING'
      })

      const savedDetails = data.details || {}
      const mergedDetails = { ...savedDetails }
      if (Object.keys(savedDetails).length === 0) {
        DEFAULT_DYNAMIC_FIELDS.forEach(f => {
          mergedDetails[f] = ''
        })
      }
      setDetails(mergedDetails)
      setInitialSelectionSheetHtml(mergedDetails.selectionSheetHtml || '')

      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft)
          if (parsed.siteData) setSiteData(parsed.siteData)
          if (parsed.details) setDetails(parsed.details)
          setIsDraftRestored(true)
        } catch (e) { }
      }

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

  const handleRemoveField = (fieldKey) => {
    if (!window.confirm(`Remove "${fieldKey}"?`)) return
    setDetails(prev => {
      const newDetails = { ...prev }
      delete newDetails[fieldKey]
      return newDetails
    })
  }

  const handlePhoneChange = (e) => {
    const val = e.target.value.replace(/\D/g, '') // Keep only numbers
    setSiteData({ ...siteData, carpenter_phone: val })
  }

  useEffect(() => {
    if (!loading && isEditing) {
      if (skipAutoSaveRef.current) {
        skipAutoSaveRef.current = false
        return
      }
      localStorage.setItem(draftKey, JSON.stringify({ siteData, details }))
    }
  }, [siteData, details, draftKey, loading, isEditing])

  const handleDiscardDraft = () => {
    skipAutoSaveRef.current = true
    localStorage.removeItem(draftKey)
    setIsDraftRestored(false)
    if (siteId === 'new') {
      const initialDetails = {}
      DEFAULT_DYNAMIC_FIELDS.forEach(f => initialDetails[f] = '')
      setDetails(initialDetails)
      setSiteData({
        site_name: '', party_name: '', location: '', carpenter: '', carpenter_phone: '', start_date: '', end_date: '', status: 'ONGOING'
      })
    } else {
      setLoading(true)
      fetchData()
    }
  }

  async function handleSave() {
    if (!siteData.site_name.trim()) {
      alert('Please enter a Site Name (e.g. "Main Flat").')
      return
    }
    setSaving(true)

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(clientId)
    const decodedName = decodeURIComponent(clientId)

    const payload = {
      client_id: isUuid ? clientId : null,
      client_name: isUuid ? null : decodedName,
      site_name: siteData.site_name,
      party_name: siteData.party_name,
      location: siteData.location,
      carpenter: siteData.carpenter,
      carpenter_phone: siteData.carpenter_phone,
      start_date: siteData.start_date || null,
      end_date: siteData.end_date || null,
      status: siteData.status || 'ONGOING',
      details
    }

    try {
      if (siteId === 'new') {
        const { error } = await supabase.from('client_sites').insert(payload)
        if (error) throw error
        localStorage.removeItem(draftKey)
        navigate(-1)
      } else {
        const { error } = await supabase.from('client_sites').update({
          ...payload,
          updated_at: new Date().toISOString()
        }).eq('id', siteId)
        if (error) throw error
        localStorage.removeItem(draftKey)
        setIsEditing(false)
        await cleanupRemovedImages(initialSelectionSheetHtml, details.selectionSheetHtml || '')
        setInitialSelectionSheetHtml(details.selectionSheetHtml || '')
      }
    } catch (e) {
      alert('Error saving site: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCompleteSite = async () => {
    if (!window.confirm('Are you sure you want to mark this site as complete?')) return

    try {
      setSaving(true)
      const today = new Date().toISOString().split('T')[0]
      const { error } = await supabase.from('client_sites').update({
        status: 'COMPLETED',
        end_date: today,
        updated_at: new Date().toISOString()
      }).eq('id', siteId)

      if (error) throw error

      setSiteData({ ...siteData, status: 'COMPLETED', end_date: today })
      alert('Site marked as complete!')
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReopenSite = async () => {
    if (!window.confirm('Reopen this site?')) return

    try {
      setSaving(true)
      const { error } = await supabase.from('client_sites').update({
        status: 'ONGOING',
        end_date: null,
        updated_at: new Date().toISOString()
      }).eq('id', siteId)

      if (error) throw error

      setSiteData({ ...siteData, status: 'ONGOING', end_date: '' })
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
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
        <button
          className="nav-back"
          onClick={() => {
            if (isEditing && siteId !== 'new') {
              setIsEditing(false)
            } else {
              navigate(-1)
            }
          }}
          title="Back"
        >
          ←
        </button>
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

      {isDraftRestored && isEditing && (
        <div style={{
          background: '#e0f2fe',
          border: '1px solid #3b82f6',
          borderRadius: '8px',
          margin: '1rem',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e3a8a', fontWeight: '500' }}>
            <span>📝</span>
            <span>Restored unsaved draft</span>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleDiscardDraft}
            style={{ background: '#ef4444', color: 'white', padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
          >
            🗑️ Discard Draft
          </button>
        </div>
      )}

      {!isEditing ? (
        // --- VIEW MODE ---
        <div style={{ padding: '1rem' }}>
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ margin: '0 0 1rem 0', color: 'var(--primary-color)' }}>
                {client ? client.name : 'Client'} - {siteData.site_name}
              </h2>
              {siteData.status === 'COMPLETED' && (
                <span style={{ background: '#10b981', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  COMPLETED
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <DetailItem label="Party Name" value={siteData.party_name} />
              <DetailItem label="Location" value={siteData.location} />
              <DetailItem label="Carpenter" value={siteData.carpenter} />
              <DetailItem label="Carpenter Mobile No." value={siteData.carpenter_phone} />
              <DetailItem label="Site Start" value={siteData.start_date ? new Date(siteData.start_date).toLocaleDateString() : ''} />
              <DetailItem label="Site End" value={siteData.end_date ? new Date(siteData.end_date).toLocaleDateString() : ''} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              <h3
                style={{ margin: 0, color: activeTab === 'details' ? 'var(--text-color)' : 'var(--text-light)', cursor: 'pointer', opacity: activeTab === 'details' ? 1 : 0.6 }}
                onClick={() => setActiveTab('details')}
              >
                Material Description
              </h3>
              {siteId !== 'new' && (
                <h3
                  style={{ margin: 0, color: activeTab === 'selection_sheet' ? 'var(--text-color)' : 'var(--text-light)', cursor: 'pointer', opacity: activeTab === 'selection_sheet' ? 1 : 0.6 }}
                  onClick={() => setActiveTab('selection_sheet')}
                >
                  Selection Sheets
                </h3>
              )}
            </div>

            {activeTab === 'selection_sheet' ? (
              <SelectionSheetTab
                initialContent={details.selectionSheetHtml || ''}
                tableData={details.selectionSheetTable}
                clientName={client?.name || ''}
                siteName={siteData.site_name}
                partyName={siteData.party_name}
                isEditing={false}
                onUpdate={(html) => handleDetailChange('selectionSheetHtml', html)}
                onTableUpdate={(table) => handleDetailChange('selectionSheetTable', table)}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {Object.entries(details).filter(([k, val]) => val !== null && typeof val !== 'object' && val.toString().trim() !== '' && k !== 'selectionSheetHtml' && k !== 'selectionSheetTable').map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', padding: '0.75rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <div style={{ flex: '0 0 140px', fontWeight: 'bold', color: 'var(--text-light)' }}>{key}</div>
                    <div style={{ flex: 1 }}>{val}</div>
                  </div>
                ))}
                {Object.entries(details).filter(([k, val]) => val !== null && typeof val !== 'object' && val.toString().trim() !== '' && k !== 'selectionSheetHtml' && k !== 'selectionSheetTable').length === 0 && (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-light)', fontStyle: 'italic', background: '#f8fafc', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
                    No material details added yet. Click Edit to add some!
                  </div>
                )}
              </div>
            )}
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
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Site Name *</label>
                <input
                  type="text"
                  className="input nav-input"
                  placeholder="e.g. Office..."
                  value={siteData.site_name}
                  onChange={e => setSiteData({ ...siteData, site_name: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Party Name</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.party_name}
                  onChange={e => setSiteData({ ...siteData, party_name: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Location</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.location}
                  onChange={e => setSiteData({ ...siteData, location: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Carpenter</label>
                <input
                  type="text"
                  className="input nav-input"
                  value={siteData.carpenter}
                  onChange={e => setSiteData({ ...siteData, carpenter: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Carpenter Mobile No.</label>
                <input
                  type="tel"
                  className="input nav-input"
                  value={siteData.carpenter_phone}
                  onChange={handlePhoneChange}
                  placeholder="Numbers only"
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold', fontSize: '0.85rem' }}>Site Start Date</label>
                <input
                  type="date"
                  className="input nav-input"
                  value={siteData.start_date}
                  onChange={e => setSiteData({ ...siteData, start_date: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              <h3
                style={{ margin: 0, color: activeTab === 'details' ? 'var(--text-color)' : 'var(--text-light)', cursor: 'pointer', opacity: activeTab === 'details' ? 1 : 0.6 }}
                onClick={() => setActiveTab('details')}
              >
                Material Details
              </h3>
              {siteId !== 'new' && (
                <h3
                  style={{ margin: 0, color: activeTab === 'selection_sheet' ? 'var(--text-color)' : 'var(--text-light)', cursor: 'pointer', opacity: activeTab === 'selection_sheet' ? 1 : 0.6 }}
                  onClick={() => setActiveTab('selection_sheet')}
                >
                  Selection Sheets
                </h3>
              )}
            </div>

            {activeTab === 'selection_sheet' ? (
              <SelectionSheetTab
                initialContent={details.selectionSheetHtml || ''}
                tableData={details.selectionSheetTable}
                clientName={client?.name || ''}
                siteName={siteData.site_name}
                partyName={siteData.party_name}
                isEditing={true}
                onUpdate={(html) => handleDetailChange('selectionSheetHtml', html)}
                onTableUpdate={(table) => handleDetailChange('selectionSheetTable', table)}
              />
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  {Object.entries(details).filter(([k]) => k !== 'selectionSheetHtml' && k !== 'selectionSheetTable').map(([key, val]) => (
                    <div key={key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-light)' }}>{key}</label>
                        <button 
                          type="button" 
                          onClick={() => handleRemoveField(key)} 
                          style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '1.25rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                          title="Remove field"
                        >
                          ×
                        </button>
                      </div>
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
              </>
            )}
          </div>
        </div>
      )}

      {siteId !== 'new' && (
        <div style={{
          marginTop: '3rem',
          padding: '1rem',
          textAlign: 'center',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'center'
        }}>
          {siteData.status === 'ONGOING' ? (
            <button
              style={{
                background: 'transparent',
                color: '#10b981',
                border: '1px solid #10b981',
                borderRadius: '20px',
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
              onClick={handleCompleteSite}
              disabled={saving}
            >
              ✓ Mark Site as Completed
            </button>
          ) : (
            <button
              style={{
                background: 'transparent',
                color: 'var(--text-light)',
                border: '1px solid #cbd5e1',
                borderRadius: '20px',
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
              onClick={handleReopenSite}
              disabled={saving}
            >
              ↺ Reopen Site
            </button>
          )}
        </div>
      )}
    </div>
  )
}
