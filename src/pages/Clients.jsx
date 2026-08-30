import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isFuzzyMatch } from '../lib/searchUtils'
import { useAuth } from '../context/AuthContext'

export default function Clients() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedClients, setSelectedClients] = useState(new Set())
  const [unlinkedNames, setUnlinkedNames] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  // Add Client Modal State
  const [showModal, setShowModal] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newOwnerName, setNewOwnerName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newSecondaryMobile, setNewSecondaryMobile] = useState('')
  const [newOfficeLocation, setNewOfficeLocation] = useState('')
  const [newClientType, setNewClientType] = useState('GREEN')
  const [newBalance, setNewBalance] = useState('')
  const [editClientId, setEditClientId] = useState(null)

  async function handleAddClient(e) {
    e.preventDefault()
    if (!newCompanyName.trim() && !newOwnerName.trim()) return

    const combinedName = [newCompanyName.trim(), newOwnerName.trim()].filter(Boolean).join(' - ').toUpperCase()

    const payload = {
      name: combinedName,
      company_name: newCompanyName.trim().toUpperCase(),
      owner_name: newOwnerName.trim().toUpperCase(),
      mobile: newMobile.trim(),
      secondary_mobile: newSecondaryMobile.trim(),
      office_location: newOfficeLocation.trim(),
      client_type: newClientType,
      opening_balance: Number(newBalance) || 0
    }

    let error;
    let newClientId = editClientId;

    if (editClientId) {
      const { error: err } = await supabase.from('clients').update(payload).eq('id', editClientId)
      error = err;
    } else {
      const { data, error: err } = await supabase.from('clients').insert([payload]).select().single()
      error = err;
      if (data) newClientId = data.id;
    }

    if (!error && editClientId) {
      // Sync denormalized name across tables when name changes
      await supabase.from('estimates').update({ client_name: payload.name }).eq('client_id', editClientId)
      await supabase.from('client_sites').update({ client_name: payload.name }).eq('client_id', editClientId)
    }

    if (!error && !editClientId && newClientId) {
      // Auto-Link loose records
      await supabase.from('estimates').update({ client_id: newClientId }).eq('client_name', payload.name).is('client_id', null)
      await supabase.from('client_sites').update({ client_id: newClientId }).eq('client_name', payload.name).is('client_id', null)
    }

    if (error) {
      alert("Error saving client: " + error.message)
    } else {
      setShowModal(false)
      setNewCompanyName('')
      setNewOwnerName('')
      setNewMobile('')
      setNewSecondaryMobile('')
      setNewOfficeLocation('')
      setNewClientType('GREEN')
      setNewBalance('')
      setEditClientId(null)
      loadClients()
    }
  }

  async function handleEditClick(c, e) {
    e.stopPropagation()
    setEditClientId(c.id)
    setNewCompanyName(c.company_name || c.name || '')
    setNewOwnerName(c.owner_name || '')
    setNewMobile(c.mobile || '')
    setNewSecondaryMobile(c.secondary_mobile || '')
    setNewOfficeLocation(c.office_location || '')
    setNewClientType(c.client_type || 'GREEN')
    setNewBalance(c.opening_balance || '')
    setShowModal(true)
  }

  async function loadClients() {
    setLoading(true)
    try {
      const { data: clientData } = await supabase.from('clients').select('*').order('name')
      const { data: estData } = await supabase.from('estimates').select('client_id, client_name, grand_total, type, is_archived').in('type', ['ESTIMATE', 'DELETED_ESTIMATE', 'RETURN', 'DELETED_RETURN'])
      const { data: payData } = await supabase.from('payments').select('client_id, amount, is_archived')
      const { data: siteNamesData } = await supabase.from('client_sites').select('client_name').is('client_id', null)

      const unlinkedSet = new Set()
      if (estData) {
        estData.forEach(e => {
          if (!e.client_id && e.client_name) unlinkedSet.add(e.client_name.trim().toUpperCase())
        })
      }
      if (siteNamesData) {
        siteNamesData.forEach(s => {
          if (s.client_name) unlinkedSet.add(s.client_name.trim().toUpperCase())
        })
      }
      setUnlinkedNames(Array.from(unlinkedSet).sort())

      const combined = (clientData || []).map(c => {
        const clientEsts = (estData || []).filter(e => e.client_id === c.id && !e.is_archived)
        const estTotal = clientEsts.filter(e => e.type === 'ESTIMATE' || e.type === 'DELETED_ESTIMATE').reduce((sum, e) => sum + (Number(e.grand_total) || 0), 0)
        const returnTotal = clientEsts.filter(e => e.type === 'RETURN' || e.type === 'DELETED_RETURN').reduce((sum, e) => sum + (Number(e.grand_total) || 0), 0)
        const payTotal = (payData || []).filter(p => p.client_id === c.id && !p.is_archived).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
        const balance = Number(c.opening_balance || 0) + estTotal - returnTotal - payTotal
        return { ...c, balance }
      })

      setClients(combined)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => { loadClients() }, [])

  async function handleDeleteClient(id, name) {
    if (!window.confirm(`Are you sure you want to delete ${name}?\n\nThis will permanently delete all their payment records. Their estimates will NOT be deleted, but they will no longer be linked to a client account.`)) return

    try {
      const { error } = await supabase.from('clients').delete().eq('id', id)
      if (error) throw error
      loadClients()
    } catch (e) {
      alert("Failed to delete client: " + e.message)
    }
  }

  async function handleDeleteAllClients() {
    if (!window.confirm('WARNING: Are you absolutely sure you want to delete ALL clients?\n\nThis will permanently delete EVERY ledger account and EVERY payment record in the system. This cannot be undone!')) return

    const verify = window.prompt("Type 'DELETE' to confirm wiping all ledgers.")
    if (verify !== 'DELETE') {
      if (verify !== null) alert("Deletion cancelled.")
      return
    }

    try {
      const { error } = await supabase.from('clients').delete().not('id', 'is', null)
      if (error) throw error
      loadClients()
      alert("All clients and ledgers have been successfully deleted.")
    } catch (e) {
      alert("Failed to delete all clients: " + e.message)
    }
  }

  function handleSelectAll(filtered) {
    if (selectedClients.size === filtered.length && filtered.length > 0) {
      setSelectedClients(new Set())
    } else {
      setSelectedClients(new Set(filtered.map(c => c.id)))
    }
  }

  function handleSelectRow(id, e) {
    e.stopPropagation()
    const next = new Set(selectedClients)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedClients(next)
  }

  async function handleDeleteSelected() {
    if (selectedClients.size === 0) return
    if (!window.confirm(`Are you sure you want to delete ${selectedClients.size} selected clients?\n\nThis will permanently delete all their payment records.`)) return

    try {
      const { error } = await supabase.from('clients').delete().in('id', Array.from(selectedClients))
      if (error) throw error
      setSelectedClients(new Set())
      loadClients()
    } catch (e) {
      alert("Failed to delete selected clients: " + e.message)
    }
  }

  const searchStr = newCompanyName.trim().toUpperCase();
  const exactMatch = clients.some(c => c.name.toUpperCase() === searchStr && c.id !== editClientId);
  
  let clientSuggestions = [];
  if (showSuggestions && !editClientId && searchStr) {
    clients.forEach(c => {
      if (c.name.toUpperCase().includes(searchStr)) {
        clientSuggestions.push({ name: c.name, type: 'EXISTING' });
      }
    });
    unlinkedNames.forEach(n => {
      if (n.includes(searchStr) && !clientSuggestions.some(s => s.name === n)) {
        clientSuggestions.push({ name: n, type: 'UNLINKED' });
      }
    });
  }

  return (
    <div className="app-container">
      <div className="header">
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
          <button className="back-btn" onClick={() => navigate('/')} title="Home">🏠 Home</button>
        </div>
        <h1>Clients & Ledger</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className="page" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div className="search-bar" style={{ flex: '1 1 250px', margin: 0 }}>
                <span>🔍</span>
                <input
                  placeholder="Search clients by name or mobile..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {role === 'ADMIN' && selectedClients.size > 0 && (
                  <button className="btn btn-danger" style={{ margin: 0, whiteSpace: 'nowrap', backgroundColor: '#dc2626' }} onClick={handleDeleteSelected}>
                    🗑️ Delete Selected ({selectedClients.size})
                  </button>
                )}
                {role === 'ADMIN' && clients.length > 0 && (
                  <button className="btn btn-danger" style={{ margin: 0, whiteSpace: 'nowrap' }} onClick={handleDeleteAllClients}>
                    🗑️ Delete All
                  </button>
                )}
                <button className="btn btn-primary" style={{ margin: 0, whiteSpace: 'nowrap' }} onClick={() => {
                  setEditClientId(null)
                  setNewCompanyName('')
                  setNewOwnerName('')
                  setNewMobile('')
                  setNewSecondaryMobile('')
                  setNewOfficeLocation('')
                  setNewClientType('GREEN')
                  setNewBalance('')
                  setShowModal(true)
                }}>
                  ➕ Add Client
                </button>
              </div>
            </div>

            {(() => {
              const filteredClients = clients.filter(c => {
                const s = search.trim().toLowerCase()
                if (!s) return true;
                const searchTerms = s.split(/\s+/);
                const smartTerms = s.match(/[a-z]+|[0-9]+/g) || []
                const targetStr = `${c.name || ''} ${c.mobile || ''}`.toLowerCase();

                const matchesAllTerms = searchTerms.every(term => targetStr.includes(term));
                const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => targetStr.includes(term));
                const sNoSpace = s.replace(/\s+/g, '');

                return targetStr.includes(s) ||
                  targetStr.replace(/\s+/g, '').includes(sNoSpace) ||
                  matchesAllTerms ||
                  matchesSmartTerms ||
                  isFuzzyMatch(sNoSpace, c.name.toLowerCase()) ||
                  isFuzzyMatch(sNoSpace, (c.mobile || '').toLowerCase())
              });

              return (
                <>
                  {role === 'ADMIN' && filteredClients.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 8px', gap: 12 }}>
                      <input
                        type="checkbox"
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                        checked={selectedClients.size === filteredClients.length && filteredClients.length > 0}
                        onChange={() => handleSelectAll(filteredClients)}
                      />
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>
                        Select All
                      </span>
                    </div>
                  )}

                  {filteredClients.map(c => (
                    <div key={c.id} className="card" style={{ padding: 16, cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center', backgroundColor: selectedClients.has(c.id) ? '#f0f9ff' : 'white' }} onClick={() => navigate(`/clients/${c.id}`)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: '150px' }}>
                        {role === 'ADMIN' && (
                          <input
                            type="checkbox"
                            style={{ width: 18, height: 18, cursor: 'pointer' }}
                            checked={selectedClients.has(c.id)}
                            onChange={(e) => handleSelectRow(c.id, e)}
                            onClick={e => e.stopPropagation()}
                          />
                        )}
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: c.client_type === 'RED' ? '#ef4444' : c.client_type === 'YELLOW' ? '#eab308' : '#22c55e', flexShrink: 0 }} title={`Client Type: ${c.client_type || 'GREEN'}`} />
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{c.mobile || 'No Mobile'}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Outstanding Balance</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: c.balance > 0 ? '#ef4444' : (c.balance < 0 ? '#10b981' : '#000') }}>
                            ₹ {Math.abs(c.balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {c.balance > 0 ? 'Dr' : (c.balance < 0 ? 'Cr' : '')}
                          </div>
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{ color: '#3b82f6', padding: '6px' }} title="Edit Client" onClick={(e) => handleEditClick(c, e)}>
                          ✏️
                        </button>
                        {role === 'ADMIN' && (
                          <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444', padding: '6px' }} title="Delete Client" onClick={(e) => { e.stopPropagation(); handleDeleteClient(c.id, c.name); }}>
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {filteredClients.length === 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                      No clients found.
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ marginTop: 0 }}>{editClientId ? 'Edit Client' : 'Add New Client'}</h3>
            <form onSubmit={handleAddClient} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Client / Company Name</label>
                <input type="text" value={newCompanyName}
                  onChange={e => {
                    setNewCompanyName(e.target.value.toUpperCase())
                    setShowSuggestions(true)
                    setActiveIndex(-1)
                  }}
                  onKeyDown={e => {
                    if (!showSuggestions || clientSuggestions.length === 0) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setActiveIndex(prev => (prev < clientSuggestions.length - 1 ? prev + 1 : prev))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setActiveIndex(prev => (prev > 0 ? prev - 1 : 0))
                    } else if (e.key === 'Enter') {
                      if (activeIndex >= 0 && activeIndex < clientSuggestions.length) {
                        e.preventDefault()
                        setNewCompanyName(clientSuggestions[activeIndex].name)
                        setShowSuggestions(false)
                        setActiveIndex(-1)
                      }
                    } else if (e.key === 'Escape') {
                      setShowSuggestions(false)
                    }
                  }}
                  onFocus={() => { setShowSuggestions(true); setActiveIndex(-1); }}
                  onBlur={() => setTimeout(() => { setShowSuggestions(false); setActiveIndex(-1); }, 200)}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4, textTransform: 'uppercase' }}
                />

                {(() => {
                  return (
                    <>
                      {exactMatch && (
                        <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, fontWeight: 500 }}>
                          ⚠️ A client with this exact name already exists.
                        </div>
                      )}
                      {clientSuggestions.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ccc', zIndex: 10, maxHeight: 150, overflowY: 'auto', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', borderRadius: '0 0 4px 4px' }}>
                          {clientSuggestions.map((s, idx) => (
                            <div key={idx} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: 14, display: 'flex', justifyContent: 'space-between', backgroundColor: activeIndex === idx ? '#f1f5f9' : 'white' }}
                              onMouseDown={() => {
                                setNewCompanyName(s.name)
                                setShowSuggestions(false)
                                setActiveIndex(-1)
                              }}
                              onMouseEnter={() => setActiveIndex(idx)}
                              onMouseLeave={() => setActiveIndex(-1)}
                            >
                              <span>{s.name}</span>
                              <span style={{ fontSize: 10, color: s.type === 'EXISTING' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: s.type === 'EXISTING' ? 600 : 400 }}>
                                {s.type === 'EXISTING' ? 'Already Exists' : '(Auto-Link)'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Owner Name</label>
                <input type="text" value={newOwnerName} onChange={e => setNewOwnerName(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4, textTransform: 'uppercase' }} />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Mobile Number</label>
                  <input type="text" value={newMobile} onChange={e => setNewMobile(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Secondary Mobile</label>
                  <input type="text" value={newSecondaryMobile} onChange={e => setNewSecondaryMobile(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Office Location</label>
                <input type="text" value={newOfficeLocation} onChange={e => setNewOfficeLocation(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>Client Type</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="clientType" value="GREEN" checked={newClientType === 'GREEN'} onChange={e => setNewClientType(e.target.value)} />
                    <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#22c55e' }} /> Green
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="clientType" value="YELLOW" checked={newClientType === 'YELLOW'} onChange={e => setNewClientType(e.target.value)} />
                    <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#eab308' }} /> Yellow
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="clientType" value="RED" checked={newClientType === 'RED'} onChange={e => setNewClientType(e.target.value)} />
                    <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#ef4444' }} /> Red
                  </label>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Previous Pending Payment (₹)</label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px 0' }}>If this client owes you money from before, enter it here.</p>
                <input type="number" step="0.01" value={newBalance} onChange={e => setNewBalance(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" className="primary-btn" style={{ flex: 1, margin: 0 }}>Save Client</button>
                <button type="button" className="home-btn" style={{ flex: 1, margin: 0, background: '#f1f5f9' }} onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
