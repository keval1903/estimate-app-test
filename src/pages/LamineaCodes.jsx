import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePlatform } from '../context/PlatformContext'
import { useToast } from '../hooks/useToast'
import { isFuzzyMatch } from '../lib/searchUtils'
import * as XLSX from 'xlsx'

function normalizeAlternativeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase()
}

function normalizeProductCode(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export default function LamineaCodes() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { activePlatform } = usePlatform()
  const { showToast, ToastEl } = useToast()

  const [codes, setCodes] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  
  const [showImportModal, setShowImportModal] = useState(false)
  const [importMode, setImportMode] = useState('merge') // 'merge' or 'replace'
  const [previewRows, setPreviewRows] = useState([])
  const [showPreviewModal, setShowPreviewModal] = useState(false)

  const [search, setSearch] = useState('')
  const [searchBy, setSearchBy] = useState('alternative_code') // 'alternative_code' | 'product_code' | 'product_name'

  useEffect(() => {
    if (activePlatform !== 'laminea') {
      navigate('/')
      return
    }
    loadData()
  }, [activePlatform, role])

  async function loadData() {
    setLoading(true)
    try {
      const { data: cData, error: cErr } = await supabase
        .from('laminea_product_codes')
        .select(`
          id,
          alternative_code,
          is_active,
          product_id,
          products ( product_name, product_code, in_laminea )
        `)
        .order('alternative_code')
        
      if (cErr) throw cErr

      const { data: pData, error: pErr } = await supabase
        .from('products')
        .select('id, product_name, product_code')
        .eq('in_laminea', true)
        .order('product_name')

      if (pErr) throw pErr

      setCodes(cData || [])
      setProducts(pData || [])
    } catch (e) {
      showToast('Error loading data: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleActive(id, currentStatus) {
    if (!window.confirm(`Are you sure you want to ${currentStatus ? 'disable' : 'reactivate'} this code?`)) return
    try {
      const { error } = await supabase
        .from('laminea_product_codes')
        .update({ is_active: !currentStatus })
        .eq('id', id)
      
      if (error) throw error
      showToast(`Code ${currentStatus ? 'disabled' : 'reactivated'} ✓`)
      loadData()
    } catch (e) {
      showToast('Failed to update status: ' + e.message, 'error')
    }
  }

  async function handleAddCode(e) {
    e.preventDefault()
    if (!newCode.trim() || !selectedProductId) {
      showToast('Code and Product are required', 'error')
      return
    }

    try {
      const { error } = await supabase
        .from('laminea_product_codes')
        .insert({
          alternative_code: newCode.trim(),
          product_id: selectedProductId,
          is_active: true
        })
      
      if (error) throw error

      showToast('Code mapped successfully ✓')
      setShowAddModal(false)
      setNewCode('')
      setSelectedProductId('')
      loadData()
    } catch (e) {
      showToast('Failed to map code: ' + e.message, 'error')
    }
  }

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return

    setLoading(true)
    try {
      // Fetch all products
      const allProducts = []
      let from = 0
      const limit = 1000
      while (true) {
        const { data, error } = await supabase.from('products').select('id, product_name, product_code').eq('in_laminea', true).range(from, from + limit - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        allProducts.push(...data)
        if (data.length < limit) break
        from += limit
      }

      // Fetch all codes
      const allCodes = []
      from = 0
      while (true) {
        const { data, error } = await supabase.from('laminea_product_codes').select('id, alternative_code, is_active, product_id').range(from, from + limit - 1)
        if (error) throw error
        if (!data || data.length === 0) break
        allCodes.push(...data)
        if (data.length < limit) break
        from += limit
      }

      const reader = new FileReader()
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target.result
          const wb = XLSX.read(bstr, { type: 'binary' })
          const wsname = wb.SheetNames[0]
          const ws = wb.Sheets[wsname]
          const data = XLSX.utils.sheet_to_json(ws, { raw: false })

          const preview = []
          const seenCodes = new Set()

          for (const row of data) {
            const rawAlt = (row['AlternativeCode'] || row['Alternative Code'] || row['Code'] || '').toString()
            const rawCode = (row['ProductCode'] || row['Product Code'] || row['ActualCode'] || '').toString()
            if (!rawAlt || !rawCode) continue

            const normAlt = normalizeAlternativeCode(rawAlt)
            const normProd = normalizeProductCode(rawCode)

            if (seenCodes.has(normAlt)) {
              preview.push({ alternativeCode: rawAlt, productCode: rawCode, action: 'DUPLICATE IN FILE', targetProductId: null })
              continue
            }
            seenCodes.add(normAlt)

            const targetProduct = allProducts.find(p => normalizeProductCode(p.product_code) === normProd)
            if (!targetProduct) {
              preview.push({ alternativeCode: rawAlt, productCode: rawCode, action: 'UNKNOWN PRODUCT', targetProductId: null })
              continue
            }

            const existingMapping = allCodes.find(c => normalizeAlternativeCode(c.alternative_code) === normAlt)

            let action = ''
            if (!existingMapping) {
              action = 'NEW'
            } else if (existingMapping.product_id !== targetProduct.id) {
              action = 'CONFLICT'
            } else if (!existingMapping.is_active) {
              action = 'REACTIVATE'
            } else {
              action = 'UNCHANGED'
            }

            

            preview.push({ alternativeCode: rawAlt, productCode: rawCode, action, targetProductId: targetProduct.id })
          }

          setPreviewRows(preview)
          setShowPreviewModal(true)
          setShowImportModal(false)
        } catch (err) {
          showToast('File parse failed: ' + err.message, 'error')
        } finally {
          setLoading(false)
          e.target.value = null
        }
      }
      reader.readAsBinaryString(file)
    } catch (err) {
      showToast('Fetch failed: ' + err.message, 'error')
      setLoading(false)
      e.target.value = null
    }
  }

  async function executeImport() {
    const hasErrors = previewRows.some(r => ['CONFLICT', 'UNKNOWN PRODUCT', 'DUPLICATE IN FILE'].includes(r.action))
    if (hasErrors) {
       showToast('Cannot import with errors present.', 'error')
       return
    }

    if (importMode === 'replace') {
       if (!window.confirm('Warning: Replace mode will deactivate all existing active codes not in this file. Continue?')) return;
    }

    setLoading(true)
    try {
       const { data, error } = await supabase.rpc('import_laminea_alternative_codes', {
          p_rows: previewRows,
          p_mode: importMode === 'replace' ? 'REPLACE' : 'MERGE'
       })

       if (error) throw error

       showToast(`Import complete. Created: ${data.created}, Reactivated: ${data.reactivated}, Disabled: ${data.disabled}`, 'success', 5000)
       setShowPreviewModal(false)
       setPreviewRows([])
       loadData()
    } catch (err) {
       showToast('Import failed: ' + err.message, 'error')
    } finally {
       setLoading(false)
    }
  }

  if (loading) return <div className="app-container"><div className="spinner" /></div>

  const s = search.trim().toLowerCase()
  const filteredCodes = s
    ? codes.filter(c => {
        if (searchBy === 'alternative_code') {
          const v = (c.alternative_code || '').toLowerCase()
          return v.includes(s) || isFuzzyMatch(s, v)
        }
        if (searchBy === 'product_code') {
          const v = (c.products?.product_code || '').toLowerCase()
          return v.includes(s) || isFuzzyMatch(s, v)
        }
        // product_name
        const v = (c.products?.product_name || '').toLowerCase()
        return v.includes(s) || isFuzzyMatch(s, v)
      })
    : codes

  return (
    <div className="app-container">
      {ToastEl}
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate(`/${activePlatform}`)} title="Home">🏠</button>
        <span className="nav-title">Laminea Alternative Codes</span>
      </div>

      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            Mapped Codes ({filteredCodes.length}{filteredCodes.length !== codes.length ? `/${codes.length}` : ''})
          </h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>
              📥 Import Excel
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
              + Add Code
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 16 }}>🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search by ${searchBy === 'alternative_code' ? 'alternative code' : searchBy === 'product_code' ? 'product code' : 'product name'}...`}
              style={{ width: '100%', paddingLeft: 34, paddingRight: 10, height: 38, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' }}
            />
          </div>
          <select
            value={searchBy}
            onChange={e => { setSearchBy(e.target.value); setSearch('') }}
            style={{ height: 38, borderRadius: 8, border: '1px solid #d1d5db', padding: '0 10px', fontSize: 13, background: '#f9fafb', cursor: 'pointer' }}
          >
            <option value="alternative_code">Alternative Code</option>
            <option value="product_code">Product Code</option>
            <option value="product_name">Product Name</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>Alternative Code</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>Product Code</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Product Name</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151' }}>Status</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#374151', width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCodes.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
                  {codes.length === 0 ? 'No codes mapped yet. Use "+ Add Code" to create one.' : `No results for "${search}"`}
                </td></tr>
              ) : (
                filteredCodes.map((c, i) => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5, borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--accent, #7c5c2e)', fontFamily: 'monospace', fontSize: 15 }}>{c.alternative_code}</td>
                    <td style={{ padding: '10px 14px', color: '#374151', fontFamily: 'monospace' }}>{c.products?.product_code || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>
                      {c.products?.product_name || <span style={{ color: '#d1d5db' }}>—</span>}
                      {!c.products?.in_laminea && <span style={{ color: '#ef4444', fontSize: 11, marginLeft: 6 }}>(Disabled)</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ 
                        padding: '3px 10px', 
                        borderRadius: 20, 
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        background: c.is_active ? '#dcfce7' : '#fee2e2', 
                        color: c.is_active ? '#166534' : '#991b1b'
                      }}>
                        {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        onClick={() => handleToggleActive(c.id, c.is_active)}
                        title={c.is_active ? "Disable Code" : "Reactivate Code"}
                        style={{ color: c.is_active ? '#ef4444' : '#16a34a' }}
                      >
                        {c.is_active ? '🚫 Disable' : '✅ Enable'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Add Alternative Code</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddCode}>
              <div className="field">
                <label>Alternative Code</label>
                <input 
                  autoFocus
                  required
                  value={newCode} 
                  onChange={e => setNewCode(e.target.value)} 
                  placeholder="e.g. 1234 A" 
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
              <div className="field">
                <label>Target Product</label>
                <select 
                  required
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', fontSize: '14px', fontFamily: 'inherit' }}
                >
                  <option value="">-- Select Product --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.product_code ? `[${p.product_code}] ` : ''}{p.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button type="button" className="btn btn-secondary btn-full" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-full">Save Code</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowImportModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Import Codes from Excel</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Excel file must contain two columns: <strong>AlternativeCode</strong> and <strong>ProductCode</strong>.
            </p>
            
            <div className="field">
              <label>Import Mode</label>
              <select value={importMode} onChange={e => setImportMode(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', fontSize: '14px', fontFamily: 'inherit' }}>
                <option value="add">Add Mode (Only add new codes, keep existing active)</option>
                <option value="replace">Replace Mode (Deactivate all codes NOT in this file)</option>
              </select>
            </div>
            
            <div className="field" style={{ marginTop: 16 }}>
              <input type="file" accept=".xlsx,.csv" onChange={handleImport} style={{ padding: '10px 0', border: 'none', fontSize: 14 }} />
            </div>
            
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary btn-full" onClick={() => setShowImportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
