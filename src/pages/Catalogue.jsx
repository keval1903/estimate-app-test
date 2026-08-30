import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isFuzzyMatch } from '../lib/searchUtils'

export default function Catalogue() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('Lent') // 'Lent' or 'Returned'
  const [items, setItems] = useState([])
  const [inventoryList, setInventoryList] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchBy, setSearchBy] = useState('client_name')
  const [activeDropdown, setActiveDropdown] = useState(null) // tracks which row has active inventory suggestions

  // Form states
  const [showForm, setShowForm] = useState(false)
  const defaultItem = { inventory_item: '', quantity: 1, advance_amount: 0, remark: '' }
  const [formData, setFormData] = useState({
    lent_date: new Date().toISOString().split('T')[0],
    client_name: '',
    location: '',
    mobile: '',
    items: [{ ...defaultItem }]
  })

  useEffect(() => {
    fetchData()
  }, [activeTab])

  // Close modal on Escape
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape' && showForm) {
        setShowForm(false)
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [showForm])

  async function fetchData() {
    setLoading(true)
    try {
      // Fetch catalogue items based on tab
      const { data: catData, error: catError } = await supabase
        .from('catalogue')
        .select('*')
        .eq('is_returned', activeTab === 'Returned')
        .order('lent_date', { ascending: false })

      if (catError) throw catError
      setItems(catData || [])

      // Fetch inventory list for suggestions from both tables
      const { data: invData } = await supabase
        .from('catalogue_items')
        .select('item_name')

      const { data: allCatData } = await supabase
        .from('catalogue')
        .select('inventory_item')

      const uniqueNames = new Set()
      if (invData) invData.forEach(d => { if (d.item_name) uniqueNames.add(d.item_name) })
      if (allCatData) allCatData.forEach(d => { if (d.inventory_item) uniqueNames.add(d.inventory_item) })

      const combinedList = Array.from(uniqueNames).sort().map(name => ({ item_name: name }))
      setInventoryList(combinedList)

    } catch (error) {
      console.error('Error fetching data:', error)
      alert('Error fetching data')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddSubmit(e) {
    e.preventDefault()

    try {
      // Prepare bulk insert
      const inserts = formData.items.map(item => ({
        lent_date: formData.lent_date,
        client_name: formData.client_name,
        location: formData.location,
        mobile: formData.mobile,
        inventory_item: item.inventory_item,
        quantity: item.quantity,
        advance_amount: item.advance_amount,
        remark: item.remark
      }))

      // Insert into catalogue
      const { error: insertError } = await supabase
        .from('catalogue')
        .insert(inserts)

      if (insertError) throw insertError

      // Upsert unique inventory items to keep list updated
      const uniqueItems = [...new Set(formData.items.map(i => i.inventory_item.trim()).filter(Boolean))]
      if (uniqueItems.length > 0) {
        const { error: upsertError } = await supabase
          .from('catalogue_items')
          .upsert(
            uniqueItems.map(name => ({ item_name: name })),
            { onConflict: 'item_name' }
          )
        if (upsertError) console.error('Failed to save to catalogue_items:', upsertError)
      }

      setShowForm(false)
      setFormData({
        lent_date: new Date().toISOString().split('T')[0],
        client_name: '',
        location: '',
        mobile: '',
        items: [{ ...defaultItem }]
      })
      fetchData()

    } catch (error) {
      console.error('Error adding item:', error)
      alert('Error adding item')
    }
  }

  function handleItemChange(index, field, value) {
    const newItems = [...formData.items]
    newItems[index][field] = value
    setFormData({ ...formData, items: newItems })
  }

  function addItem() {
    setFormData({ ...formData, items: [...formData.items, { ...defaultItem }] })
  }

  function removeItem(index) {
    const newItems = formData.items.filter((_, i) => i !== index)
    setFormData({ ...formData, items: newItems })
  }

  async function handleReturn(id) {
    if (!confirm('Mark this item as returned?')) return

    try {
      const { error } = await supabase
        .from('catalogue')
        .update({
          is_returned: true,
          return_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', id)

      if (error) throw error
      fetchData()
    } catch (error) {
      console.error('Error returning item:', error)
      alert('Error returning item')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const { error } = await supabase
        .from('catalogue')
        .delete()
        .eq('id', id)

      if (error) throw error
      fetchData()
    } catch (error) {
      console.error('Error deleting item:', error)
      alert('Error deleting item')
    }
  }

  const filteredItems = items.filter(item => {
    if (!searchTerm.trim()) return true
    const val = item[searchBy] ? item[searchBy].toString() : ''
    return isFuzzyMatch(searchTerm.trim(), val)
  })

  return (
    <div className="app-container">
      {/* Navigation */}
      <div className="top-nav" style={{ flexShrink: 0 }}>
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">Catalogue</span>
        <button
          className="btn btn-primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowForm(true)}
        >
          + Add New
        </button>
      </div>

      <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <button
            className={`btn ${activeTab === 'Lent' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('Lent')}
          >
            Lent
          </button>
          <button
            className={`btn ${activeTab === 'Returned' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('Returned')}
          >
            Returned
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-bar" style={{ display: 'flex', background: 'white', border: '1px solid #d1d5db', borderRadius: 8, padding: '0.5rem 1rem', width: '100%', maxWidth: 400, alignItems: 'center' }}>
            <span style={{ marginRight: '0.5rem', color: '#9ca3af' }}>🔍</span>
            <input
              type="text"
              placeholder={`Search by ${searchBy === 'client_name' ? 'client name' : 'inventory item'}...`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ border: 'none', outline: 'none', flex: 1, fontSize: '1rem' }}
            />
          </div>
          <select
            value={searchBy}
            onChange={e => setSearchBy(e.target.value)}
            style={{ padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #d1d5db', outline: 'none', background: 'white' }}
          >
            <option value="client_name">Search by Client Name</option>
            <option value="inventory_item">Search by Inventory Item</option>
          </select>
        </div>

        {/* Add Form Modal */}
        {showForm && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{ background: 'white', padding: '2rem', borderRadius: 8, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Add Lent Item</h3>
              <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="field">
                  <label>Date</label>
                  <input type="date" required
                    value={formData.lent_date} onChange={e => setFormData({ ...formData, lent_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Client Name</label>
                  <input type="text" required
                    value={formData.client_name} onChange={e => setFormData({ ...formData, client_name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Mobile</label>
                  <input type="text"
                    value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} />
                </div>
                <div className="field">
                  <label>Location</label>
                  <input type="text"
                    value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                </div>
                <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                  <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>Items to Lend</h4>

                  {formData.items.map((item, idx) => (
                    <div key={idx} style={{ paddingBottom: '1rem', marginBottom: '1rem', borderBottom: idx < formData.items.length - 1 ? '1px dashed #cbd5e1' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong>Item #{idx + 1}</strong>
                        {formData.items.length > 1 && (
                          <button type="button" onClick={() => removeItem(idx)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="field">
                        <div style={{ position: 'relative' }}>
                          <input type="text" required autoComplete="off"
                            value={item.inventory_item}
                            onChange={e => handleItemChange(idx, 'inventory_item', e.target.value)}
                            onFocus={() => setActiveDropdown(idx)}
                            onBlur={() => setTimeout(() => setActiveDropdown(null), 200)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setActiveDropdown(null)
                                e.stopPropagation()
                              } else if (e.key === 'Enter') {
                                if (activeDropdown === idx) {
                                  e.preventDefault() // prevent form submission
                                  const filtered = inventoryList.filter(inv => !item.inventory_item || isFuzzyMatch(item.inventory_item, inv.item_name))
                                  if (filtered.length > 0) {
                                    handleItemChange(idx, 'inventory_item', filtered[0].item_name)
                                  }
                                  setActiveDropdown(null)
                                }
                              }
                            }}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                          />
                          {activeDropdown === idx && inventoryList.length > 0 && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0,
                              background: 'white', border: '1px solid #cbd5e1',
                              borderRadius: 4, zIndex: 10, maxHeight: 150, overflowY: 'auto',
                              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginTop: 4
                            }}>
                              {inventoryList
                                .filter(inv => !item.inventory_item || isFuzzyMatch(item.inventory_item, inv.item_name))
                                .map((inv, i) => (
                                  <div
                                    key={i}
                                    style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                                    onMouseDown={(e) => {
                                      e.preventDefault(); // prevent blur before click
                                      handleItemChange(idx, 'inventory_item', inv.item_name);
                                      setActiveDropdown(null);
                                    }}
                                    onMouseEnter={(e) => e.target.style.background = '#f8fafc'}
                                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                  >
                                    {inv.item_name}
                                  </div>
                                ))}
                              {inventoryList.filter(inv => !item.inventory_item || isFuzzyMatch(item.inventory_item, inv.item_name)).length === 0 && (
                                <div style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>No matches found</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Quantity</label>
                          <input type="number" required min="1" step="any"
                            value={item.quantity} onChange={e => handleItemChange(idx, 'quantity', e.target.value)} />
                        </div>
                        <div className="field">
                          <label>Advance (₹)</label>
                          <input type="number" min="0" step="any"
                            value={item.advance_amount} onChange={e => handleItemChange(idx, 'advance_amount', e.target.value)} />
                        </div>
                      </div>
                      <div className="field" style={{ marginTop: '1rem' }}>
                        <label>Remark</label>
                        <input type="text"
                          value={item.remark} onChange={e => handleItemChange(idx, 'remark', e.target.value)} />
                      </div>
                    </div>
                  ))}

                  <button type="button" onClick={addItem} className="btn btn-ghost" style={{ width: '100%', border: '1px dashed var(--accent)', color: 'var(--accent)' }}>
                    + Add Another Item
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Table */}
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '12px 8px' }}>Date</th>
                <th style={{ padding: '12px 8px' }}>Client</th>
                <th style={{ padding: '12px 8px' }}>Location</th>
                <th style={{ padding: '12px 8px' }}>Inventory</th>
                <th style={{ padding: '12px 8px' }}>Remark</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '12px 8px' }}>Mobile</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Advance</th>
                {activeTab === 'Returned' && <th style={{ padding: '12px 8px' }}>Return Date</th>}
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center' }}>Loading...</td></tr>
              ) : filteredItems.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No items found</td></tr>
              ) : (
                filteredItems.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>{item.lent_date}</td>
                    <td style={{ padding: '12px 8px' }}>{item.client_name}</td>
                    <td style={{ padding: '12px 8px' }}>{item.location}</td>
                    <td style={{ padding: '12px 8px' }}>{item.inventory_item}</td>
                    <td style={{ padding: '12px 8px' }}>{item.remark}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>{item.quantity}</td>
                    <td style={{ padding: '12px 8px' }}>{item.mobile}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      {item.advance_amount ? `₹${item.advance_amount}` : '-'}
                    </td>
                    {activeTab === 'Returned' && <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>{item.return_date}</td>}
                    <td style={{ padding: '12px 8px', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                      {activeTab === 'Lent' && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
                          onClick={() => handleReturn(item.id)}
                        >
                          Return
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', color: '#ef4444' }}
                        onClick={() => handleDelete(item.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  )
}
