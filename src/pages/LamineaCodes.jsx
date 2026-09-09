import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { usePlatform } from '../context/PlatformContext'
import { useToast } from '../hooks/useToast'
import * as XLSX from 'xlsx'

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
  const [importMode, setImportMode] = useState('add') // 'add' or 'replace'

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

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws, { raw: false })
        
        const toInsert = []
        let errors = 0
        
        for (const row of data) {
          const alt = (row['AlternativeCode'] || row['Alternative Code'] || row['Code'] || '').toString().trim()
          const pCode = (row['ProductCode'] || row['Product Code'] || row['ActualCode'] || '').toString().trim()
          
          if (!alt || !pCode) continue
          
          const product = products.find(p => p.product_code?.toLowerCase() === pCode.toLowerCase())
          if (product) {
            toInsert.push({
              alternative_code: alt,
              product_id: product.id,
              is_active: true
            })
          } else {
            errors++
          }
        }
        
        if (toInsert.length === 0) {
          showToast('No valid rows found to import', 'error')
          return
        }
        
        if (importMode === 'replace') {
           if (!window.confirm(`Warning: Replace mode will deactivate all existing codes not in this file. Continue?`)) return;
           
           const incomingCodes = toInsert.map(i => i.alternative_code.toLowerCase().replace(/[^a-z0-9]/g, ''))
           
           const toDeactivate = codes.filter(c => !incomingCodes.includes(c.alternative_code.toLowerCase().replace(/[^a-z0-9]/g, '')))
           if (toDeactivate.length > 0) {
             const { error: deactErr } = await supabase
               .from('laminea_product_codes')
               .update({ is_active: false })
               .in('id', toDeactivate.map(c => c.id))
             
             if (deactErr) throw deactErr
           }
        }

        let successCount = 0
        for (const record of toInsert) {
           const { error } = await supabase.from('laminea_product_codes').insert(record)
           if (!error) successCount++
        }
        
        showToast(`Imported ${successCount} codes. ${errors > 0 ? `(${errors} unknown product codes skipped)` : ''} ✓`, 'success', 5000)
        setShowImportModal(false)
        loadData()
      } catch (e) {
        showToast('Import failed: ' + e.message, 'error')
      }
    }
    reader.readAsBinaryString(file)
  }

  if (loading) return <div className="app-container"><div className="spinner" /></div>

  return (
    <div className="app-container">
      {ToastEl}
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate(`/${activePlatform}`)} title="Home">🏠</button>
        <span className="nav-title">Laminea Alternative Codes</span>
      </div>

      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Mapped Codes ({codes.length})</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>
              📥 Import Excel
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
              + Add Code
            </button>
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-striped">
            <thead>
              <tr>
                <th>Alternative Code</th>
                <th>Actual Product Code</th>
                <th>Product Name</th>
                <th>Status</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>No codes mapped yet.</td></tr>
              ) : (
                codes.map(c => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.6 }}>
                    <td style={{ fontWeight: 600 }}>{c.alternative_code}</td>
                    <td>{c.products?.product_code || '-'}</td>
                    <td>{c.products?.product_name || '-'} {!c.products?.in_laminea && <span style={{ color: 'red', fontSize: 11 }}>(Disabled)</span>}</td>
                    <td>
                      <span style={{ 
                        padding: '2px 8px', 
                        borderRadius: 10, 
                        fontSize: 11, 
                        background: c.is_active ? '#dcfce7' : '#fee2e2', 
                        color: c.is_active ? '#166534' : '#991b1b'
                      }}>
                        {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        onClick={() => handleToggleActive(c.id, c.is_active)}
                        title={c.is_active ? "Disable Code" : "Reactivate Code"}
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
