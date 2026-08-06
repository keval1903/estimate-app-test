import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast.jsx'

import { getMergedUnits } from '../constants/units.js'
import { isFuzzyMatch } from '../lib/searchUtils'
import { normalizeSearchQuery } from '../lib/synonyms.js'
import { useVoiceSearch } from '../hooks/useVoiceSearch.jsx'

const EMPTY_FORM = {
  product_name: '', keyword: '', product_group: '', length: '', width: '',
  unit: '', rate: '', calculation_type: 'QUANTITY',
  has_stock: false, stock: '', add_stock: '', min_stock: '5',
  has_remark: false, has_discount: false
}

export default function Products() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { showToast, ToastEl } = useToast()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [stockMode, setStockMode] = useState('ADD') // 'ADD' or 'SET'
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCustomUnit, setShowCustomUnit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState([])
  const [importDiscrepancies, setImportDiscrepancies] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const fileRef = useRef()
  const searchInputRef = useRef()

  const { isListening, startListening, error: voiceError } = useVoiceSearch({
    onResult: (text) => {
      setSearch(text)
      if (searchInputRef.current) searchInputRef.current.focus()
    }
  })

  useEffect(() => { fetchProducts() }, [])

  useEffect(() => {
    if (products.length > 0) {
      const editId = new URLSearchParams(window.location.search).get('editId')
      if (editId) {
        const p = products.find(prod => prod.id === editId)
        if (p) openEdit(p)
      }
    }
  }, [products])

  async function fetchProducts() {
    setLoading(true)
    const [batch1, batch2] = await Promise.all ([
      supabase.from('products').select('*').order('product_name').range(0, 999),
      supabase.from('products').select('*').order('product_name').range(1000, 1999)
    ])
    if (batch1.error || batch2.error) {
      showToast('Failed to load products', 'error')
    } else {
      setProducts ([...(batch1.data || []), ...(batch2.data || [])])
    }
    setLoading(false)
    }
  

  let s = search.trim().toLowerCase()
  s = normalizeSearchQuery(s)
  
  const sNoSpace = s.replace(/\s+/g, '')
  const searchTerms = s.split(/\s+/)
  const smartTerms = s.match(/[a-z]+|[0-9]+/g) || []

  const filtered = products.filter(p => {
    const pName = p.product_name.toLowerCase()
    const matchesAllTerms = searchTerms.every(term => pName.includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.includes(term))
    return pName.includes(s) ||
           pName.replace(/\s+/g, '').includes(sNoSpace) ||
           p.unit.toLowerCase().includes(s) ||
           matchesAllTerms ||
           matchesSmartTerms ||
           isFuzzyMatch(sNoSpace, pName)
  })

  function openAdd() { setForm(EMPTY_FORM); setEditingId(null); setStockMode('SET'); setShowCustomUnit(false); setShowModal(true) }

  function openEdit(p) {
    setForm({
      product_name: p.product_name, keyword: p.keyword ?? '', product_group: p.product_group ?? '', length: p.length ?? '',
      width: p.width ?? '', unit: p.unit, rate: p.rate,
      calculation_type: p.calculation_type,
      has_stock: p.has_stock || false, stock: p.stock ?? '', add_stock: '',
      min_stock: p.min_stock ?? 5,
      has_remark: p.has_remark || false,
      has_discount: p.has_discount || false
    })
    setEditingId(p.id); setStockMode('ADD'); setShowCustomUnit(false); setShowModal(true)
  }

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target
    const val = type === 'checkbox' ? checked : value
    setForm(f => {
      const next = { ...f, [name]: val }
      if (name === 'unit') next.calculation_type = value === 'Sq.Ft' ? 'SQFT' : 'QUANTITY'
      if (name === 'calculation_type' && value === 'QUANTITY') { next.length = ''; next.width = '' }
      return next
    })
  }

  function validate() {
    if (!form.product_name.trim()) return 'Product name is required'
    if (!form.unit.trim()) return 'Unit is required'
    if (form.rate === '' || form.rate === null || form.rate === undefined || isNaN(form.rate) || Number(form.rate) < 0) return 'Valid rate is required'
    if (form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET') {
      if (!form.length || isNaN(form.length)) return 'Length is required'
      if (!form.width  || isNaN(form.width))  return 'Width is required'
    }
    if (form.has_stock) {
      if (editingId && stockMode === 'ADD') {
        if (form.add_stock === '' || isNaN(form.add_stock) || Number(form.add_stock) <= 0) return 'Valid quantity to add is required'
      } else {
        if (form.stock === '' || isNaN(form.stock)) return 'Valid stock amount is required'
      }
    }
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { showToast(err, 'error'); return }
    setSaving(true)
    let error, data
    let targetId = editingId
    let oldStock = 0

    // If not editing, check for existing product by name to update instead of insert
    if (!targetId) {
      const existing = products.find(p => p.product_name.toLowerCase() === form.product_name.trim().toLowerCase())
      if (existing) { targetId = existing.id; oldStock = existing.stock || 0 }
    } else {
      const existing = products.find(p => p.id === targetId)
      if (existing) oldStock = existing.stock || 0
    }

    let calculatedStock = 0
    if (form.has_stock) {
      if (targetId && stockMode === 'ADD') {
        calculatedStock = Number(oldStock) + Number(form.add_stock)
      } else {
        calculatedStock = Number(form.stock)
      }
    }

    const isDimensionBased = form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET'
    const payload = {
      product_name: form.product_name.trim().toUpperCase(),
      keyword: form.keyword ? form.keyword.trim() : null,
      product_group: form.product_group ? form.product_group.trim() : 'Uncategorized',
      unit: form.unit.trim(), rate: Number(form.rate),
      calculation_type: form.calculation_type,
      length: isDimensionBased && form.length ? Number(form.length) : null,
      width:  isDimensionBased && form.width  ? Number(form.width)  : null,
      has_stock: form.has_stock,
      stock: calculatedStock,
      min_stock: form.has_stock ? Number(form.min_stock || 5) : 5,
      has_remark: form.has_remark,
      has_discount: form.has_discount,
      updated_at: new Date().toISOString()
    }

    if (targetId) {
      ;({ data, error } = await supabase.from('products').update(payload).eq('id', targetId).select().single())
    } else {
      ;({ data, error } = await supabase.from('products').insert(payload).select().single())
    }
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'error'); return }

    if (payload.has_stock) {
      const diff = payload.stock - oldStock
      if (diff !== 0 || !targetId) {
        await supabase.from('stock_history').insert({
          product_id: data.id,
          change_type: 'MANUAL_ADJUST',
          quantity_changed: diff !== 0 ? diff : payload.stock
        })
      }
    }
    
    showToast(targetId ? 'Product updated ✓' : 'Product added ✓')
    setShowModal(false); fetchProducts()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) showToast('Delete failed', 'error')
    else { showToast('Product deleted'); fetchProducts() }
    setDeleteConfirm(null)
  }

  async function handleQuickAddStock(p) {
    const isPieceBased = p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET';
    const displayUnit = isPieceBased ? 'Nos.' : p.unit;
    const qtyStr = window.prompt(`Enter quantity to ADD to current stock (${p.stock} ${displayUnit}):`);
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (isNaN(qty) || qty <= 0) {
      showToast('Please enter a valid positive number', 'error');
      return;
    }
    setSaving(true);
    const newStock = Number(p.stock || 0) + qty;
    
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', p.id);
    if (error) {
      showToast('Failed to update stock: ' + error.message, 'error');
    } else {
      await supabase.from('stock_history').insert({
        product_id: p.id,
        change_type: 'MANUAL_ADJUST',
        quantity_changed: qty
      });
      showToast(`Added ${qty} ${displayUnit} to stock ✓`);
      fetchProducts();
    }
    setSaving(false);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} selected products?`)) return
    setSaving(true)

    const ids = Array.from(selectedIds)
    const chunkSize = 200
    let hasError = false

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const { error } = await supabase.from('products').delete().in('id', chunk)
      if (error) {
        hasError = true
        break
      }
    }

    setSaving(false)
    if (hasError) {
      showToast('Delete failed or partially failed', 'error')
      fetchProducts()
    } else {
      showToast(`Deleted ${selectedIds.size} products`)
      setSelectedIds(new Set())
      fetchProducts()
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setImportText(ev.target.result); parseImport(ev.target.result) }
    reader.readAsText(file)
  }

  // Parse a CSV line properly, respecting quoted fields that may contain commas
  function parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') { inQuotes = false }
        else { current += ch }
      } else {
        if (ch === '"') { inQuotes = true }
        else if (ch === ',' || ch === '\t') { result.push(current.trim()); current = '' }
        else { current += ch }
      }
    }
    result.push(current.trim())
    return result
  }

  function parseImport(text) {
    const lines = text.trim().split('\n').filter(Boolean); const rows = []
    if (lines.length === 0) return

    // Extract headers and create a map of column names to indices
    const headerCols = parseCsvLine(lines[0]).map(c => c.toLowerCase())
    const colMap = {}
    headerCols.forEach((col, idx) => {
      if (col.includes('product')) colMap['product_name'] = idx
      else if (col.includes('keyword')) colMap['keyword'] = idx
      else if (col.includes('length')) colMap['length'] = idx
      else if (col.includes('width')) colMap['width'] = idx
      else if (col === 'unit') colMap['unit'] = idx
      else if (col.includes('rate')) colMap['rate'] = idx
      else if (col.includes('calculation')) colMap['calculation_type'] = idx
      else if (col === 'has stock') colMap['has_stock'] = idx
      else if (col === 'stock') colMap['stock'] = idx
      else if (col.includes('min stock')) colMap['min_stock'] = idx
      else if (col.includes('remark')) colMap['has_remark'] = idx
      else if (col.includes('discount')) colMap['has_discount'] = idx
    })

    const hasDynamic = ('product_name' in colMap && 'rate' in colMap && 'unit' in colMap)
    const isNewFormat = lines[0].toLowerCase().includes('keyword')

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 3) continue
      
      let product_name, keyword, length, width, unit, rate, calculation_type, has_stock, stock, min_stock, has_remark, has_discount
      
      if (hasDynamic) {
        if (i === 0) continue // skip header row since we mapped it
        product_name = cols[colMap['product_name']]
        keyword = cols[colMap['keyword']]
        length = cols[colMap['length']]
        width = cols[colMap['width']]
        unit = cols[colMap['unit']]
        rate = cols[colMap['rate']]
        calculation_type = cols[colMap['calculation_type']]
        has_stock = cols[colMap['has_stock']]
        stock = cols[colMap['stock']]
        min_stock = cols[colMap['min_stock']]
        has_remark = cols[colMap['has_remark']]
        has_discount = cols[colMap['has_discount']]
      } else {
        if (isNewFormat) {
          [product_name, keyword, length, width, unit, rate, calculation_type, has_stock, stock, min_stock, has_remark, has_discount] = cols
        } else {
          [product_name, length, width, unit, rate, calculation_type, has_stock, stock, min_stock] = cols
        }
        if (product_name?.toLowerCase().includes('product') && rate?.toLowerCase().includes('rate')) continue
      }
      const errors = []
      if (!product_name?.trim()) errors.push('Missing product name')
      if (!unit?.trim()) errors.push('Missing unit')

      const parsedRate = Number(rate)
      if (isNaN(parsedRate)) {
        errors.push(`Invalid rate format: "${rate}"`)
      } else if (rate && rate.trim() && parsedRate === 0 && rate.trim() !== '0') {
        errors.push(`Rate "${rate}" evaluated to 0`)
      }
      
      const ct = calculation_type?.toUpperCase().trim()
      const calcType = (ct === 'SQFT' || ct === 'INCH' || ct === 'FEET') ? ct : 'QUANTITY'
      
      const hsLower = has_stock?.trim().toLowerCase()
      let parsedHasStock = false
      if (hsLower && !['yes','no','true','false',''].includes(hsLower)) {
        errors.push(`Unrecognized has_stock: "${has_stock}"`)
      } else {
        parsedHasStock = hsLower === 'yes' || hsLower === 'true'
      }

      const parsedStock = parsedHasStock && !isNaN(Number(stock)) ? Number(stock) : 0
      if (parsedHasStock && isNaN(Number(stock))) errors.push(`Invalid stock value: "${stock}"`)

      const parsedMinStock = min_stock && !isNaN(Number(min_stock)) ? Number(min_stock) : 5
      
      const hrLower = has_remark?.trim().toLowerCase()
      let parsedHasRemark = false
      if (hrLower && !['yes','no','true','false',''].includes(hrLower)) errors.push(`Unrecognized has_remark: "${has_remark}"`)
      else parsedHasRemark = hrLower === 'yes' || hrLower === 'true'

      const hdLower = has_discount?.trim().toLowerCase()
      let parsedHasDiscount = false
      if (hdLower && !['yes','no','true','false',''].includes(hdLower)) errors.push(`Unrecognized has_discount: "${has_discount}"`)
      else parsedHasDiscount = hdLower === 'yes' || hdLower === 'true'

      rows.push({
        product_name: product_name ? product_name.toUpperCase().trim() : '',
        keyword: keyword ? keyword.trim() : null,
        length: length ? Number(length) : null,
        width:  width  ? Number(width)  : null,
        unit: unit ? unit.trim() : '', 
        rate: isNaN(parsedRate) ? 0 : parsedRate, 
        calculation_type: calcType,
        has_stock: parsedHasStock, stock: parsedStock, min_stock: parsedMinStock,
        has_remark: parsedHasRemark, has_discount: parsedHasDiscount,
        raw_rate: rate?.trim(),
        errors
      })
    }

    // Sort rows so that errors appear at the top of the list
    rows.sort((a, b) => {
      const aHasErrors = a.errors && a.errors.length > 0;
      const bHasErrors = b.errors && b.errors.length > 0;
      if (aHasErrors && !bHasErrors) return -1;
      if (!aHasErrors && bHasErrors) return 1;
      return 0;
    });

    setImportPreview(rows)
  }

  async function handleImport() {
    if (!importPreview.length) { showToast('No valid rows to import', 'error'); return }
    setSaving(true);
    let added = 0, updated = 0;
    let hasError = false;
    const discrepancies = [];

    const toInsert = [];
    const toUpdate = [];

    // Separate rows into inserts and updates
    for (const row of importPreview) {
      const existing = products.find(p => p.product_name.toLowerCase() === row.product_name.toLowerCase());
      if (existing) {
        toUpdate.push({ ...row, id: existing.id });
        updated++;
      } else {
        toInsert.push(row);
        added++;
      }
    }

    const chunkSize = 200;

    // Process Updates using upsert
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      const chunk = toUpdate.slice(i, i + chunkSize);
      const dbChunk = chunk.map(({ raw_rate, errors, ...rest }) => rest);
      const { data, error } = await supabase.from('products').upsert(dbChunk, { onConflict: 'id' }).select();
      if (error) { 
        console.error('Update error:', error);
        hasError = true; 
        break; 
      }

      const historyBatch = [];
      for (const r of data || []) {
        const previewRow = chunk.find(p => p.product_name.toLowerCase() === r.product_name.toLowerCase());
        const existing = products.find(p => p.id === r.id);
        if (previewRow) {
          if (previewRow.has_stock) {
            const oldStock = existing ? (existing.stock || 0) : 0;
            const diff = previewRow.stock - oldStock;
            if (diff !== 0) {
              historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: diff });
            }
          }
          if (Number(r.rate) !== Number(previewRow.raw_rate) && !isNaN(Number(previewRow.raw_rate))) {
            discrepancies.push({ product_name: r.product_name, field: 'rate', expected: previewRow.raw_rate, saved: r.rate })
          }
        }
      }
      if (historyBatch.length > 0) {
        const { error: histError } = await supabase.from('stock_history').insert(historyBatch);
        if (histError) console.error('History update error:', histError);
      }
    }

    // Process Inserts
    if (!hasError) {
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const dbChunk = chunk.map(({ raw_rate, errors, ...rest }) => rest);
        const { data, error } = await supabase.from('products').insert(dbChunk).select();
        if (error) { 
          console.error('Insert error:', error);
          hasError = true; 
          break; 
        }

        const historyBatch = [];
        for (const r of data || []) {
          const previewRow = chunk.find(p => p.product_name.toLowerCase() === r.product_name.toLowerCase());
          if (previewRow) {
            if (previewRow.has_stock) {
              historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: previewRow.stock });
            }
            if (Number(r.rate) !== Number(previewRow.raw_rate) && !isNaN(Number(previewRow.raw_rate))) {
              discrepancies.push({ product_name: r.product_name, field: 'rate', expected: previewRow.raw_rate, saved: r.rate })
            }
          }
        }
        if (historyBatch.length > 0) {
          const { error: histError } = await supabase.from('stock_history').insert(historyBatch);
          if (histError) console.error('History insert error:', histError);
        }
      }
    }

    setSaving(false);
    if (hasError) {
      showToast('Import failed or partially failed', 'error');
    } else {
      showToast(`Imported: ${added} added, ${updated} updated`);
    }
    setShowImport(false); setImportPreview([]); setImportText('');
    fetchProducts();
    if (discrepancies.length > 0) setImportDiscrepancies(discrepancies);
  }

  function handleExport() {
    if (!filtered.length) { showToast('No products to export', 'error'); return }
    const headers = ['Product Name', 'Keyword', 'Length', 'Width', 'Unit', 'Rate', 'Calculation Type', 'Has Stock', 'Stock', 'Min Stock', 'Has Remark', 'Has Discount']
    const csvRows = [headers.join(',')]
    for (const p of filtered) {
      csvRows.push([
        `"${p.product_name}"`,
        `"${p.keyword || ''}"`,
        p.length || '',
        p.width || '',
        p.unit,
        p.rate,
        p.calculation_type,
        p.has_stock ? 'Yes' : 'No',
        p.has_stock ? p.stock : '',
        p.min_stock || '5',
        p.has_remark ? 'Yes' : 'No',
        p.has_discount ? 'Yes' : 'No'
      ].join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'products_export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
  }
  function toggleSelect(id) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">Product Master</span>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
            onClick={() => navigate('/stock-report')}>📊 Report</button>
          {role === 'ADMIN' && (
            <>
              <button className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
                onClick={handleExport}>⬇ Export</button>
              <button className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
                onClick={() => setShowImport(true)}>⬆ Import</button>
            </>
          )}
        </div>
      </div>

      <div className="page">
        <div className="search-bar" style={{ position: 'relative' }}>
          <span>🔍</span>
          <input 
            ref={searchInputRef}
            placeholder="Search or tap mic..."
            value={search} onChange={e => setSearch(e.target.value)} 
            style={{ paddingRight: search ? 60 : 40 }}
          />
          <div style={{ position: 'absolute', right: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
            {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>}
            <button 
              type="button"
              className={`btn btn-ghost btn-sm ${isListening ? 'listening pulse-mic' : ''}`}
              style={{ color: isListening ? 'var(--danger-color)' : 'var(--text-muted)' }}
              onPointerDown={(e) => { 
                e.preventDefault();
                e.stopPropagation();
                if (isListening) stopListening(); else startListening(); 
              }}
              title={voiceError || 'Voice Search'}
            >
              {isListening ? '🛑' : '🎤'}
            </button>
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span className="section-label">{filtered.length} Products</span>
          {filtered.length > 0 && role === 'ADMIN' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ width: 16, height: 16 }} />
                Select All
              </label>
              {selectedIds.size > 0 && (
                <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>
                  🗑 Delete ({selectedIds.size})
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? <div className="spinner" /> : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <p>{search ? 'No products match your search' : 'No products yet. Tap + ADD PRODUCT below!'}</p>
          </div>
        ) : filtered.map(p => (
          <div key={p.id} className="item-card" style={{ border: selectedIds.has(p.id) ? '2px solid var(--primary-color)' : '1px solid var(--border-light)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 }}>
                {role === 'ADMIN' && (
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                )}
                <div className="item-name">{p.product_name}</div>
              </div>
              <span className={`badge ${p.calculation_type === 'SQFT' ? 'badge-sqft' : 'badge-qty'}`}>
                {p.calculation_type}
              </span>
            </div>
            <div className="item-grid" style={{ marginTop:8, marginLeft: 26 }}>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>GROUP</span><br />{p.product_group || 'Uncategorized'}</div>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>UNIT</span><br />{p.unit}</div>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>RATE</span><br />₹{Number(p.rate).toFixed(2)}</div>
              {(p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET') && (p.length || p.width) && (
                <>
                  <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>LENGTH</span><br />{p.length} {p.calculation_type === 'INCH' || p.calculation_type === 'FEET' ? (p.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}</div>
                  <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>WIDTH</span><br />{p.width} {p.calculation_type === 'INCH' || p.calculation_type === 'FEET' ? (p.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}</div>
                </>
              )}
              {p.has_stock && (
                <div>
                  <span style={{ color:'var(--text-muted)', fontSize:12 }}>STOCK</span><br />
                  <span style={{ fontWeight: 600, color: p.stock > 0 ? 'var(--primary-color)' : 'var(--danger-color)' }}>
                    {p.stock}
                  </span>
                </div>
              )}
            </div>
            <div className="item-actions" style={{ marginLeft: 26 }}>
              {p.has_stock && (
                <button className="btn btn-primary btn-sm" style={{ background: '#10b981' }} onClick={() => handleQuickAddStock(p)}>
                  ➕ Stock
                </button>
              )}
              {role === 'ADMIN' && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>✏️ Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(p)}>🗑 Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {role === 'ADMIN' && (
        <div className="sticky-bottom">
          <div className="sticky-bottom-inner">
            <button className="btn btn-primary btn-full btn-lg" onClick={openAdd}>+ ADD PRODUCT</button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>{editingId ? 'Edit Product' : 'Add Product'}</span>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="field">
              <label>Product Name *</label>
              <input name="product_name" value={form.product_name} onChange={handleFormChange}
                placeholder="e.g. C PLY 4 18 MM 7 x 4" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Product Group</label>
                <input name="product_group" value={form.product_group || ''} onChange={handleFormChange}
                  placeholder="e.g. Hardware, Plywood" />
              </div>
              <div className="field">
                <label>Highlight Keyword (Optional)</label>
                <input name="keyword" value={form.keyword || ''} onChange={handleFormChange}
                  placeholder="e.g. PLYWOOD or SPECIAL OFFER" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Unit *</label>
                {!showCustomUnit ? (
                  <select name="unit" value={form.unit} onChange={e => {
                    if (e.target.value === 'ADD_CUSTOM') {
                      setShowCustomUnit(true)
                      setForm(f => ({ ...f, unit: '' }))
                    } else {
                      handleFormChange(e)
                    }
                  }}>
                    <option value="">Select unit</option>
                    {getMergedUnits(products).map(u => <option key={u} value={u}>{u}</option>)}
                    <option value="ADD_CUSTOM">➕ Add Custom Unit...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input name="unit" value={form.unit} onChange={handleFormChange}
                      placeholder="Type custom unit (e.g. Sheet, Gram, Dozen)" autoFocus />
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowCustomUnit(false)}>✕</button>
                  </div>
                )}
              </div>
              <div className="field">
                <label>Calculation Type *</label>
                <select name="calculation_type" value={form.calculation_type} onChange={handleFormChange}>
                  <option value="QUANTITY">QUANTITY</option>
                  <option value="SQFT">SQFT</option>
                  <option value="INCH">INCH</option>
                  <option value="FEET">FEET</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Rate (₹) *</label>
              <input name="rate" type="number" inputMode="decimal"
                value={form.rate} onChange={handleFormChange} placeholder="0.00" />
            </div>
            {(form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET') && (
              <div className="field-row">
                <div className="field">
                  <label>Length ({form.calculation_type === 'INCH' ? 'in' : 'ft'}) *</label>
                  <input name="length" type="number" inputMode="decimal"
                    value={form.length} onChange={handleFormChange} placeholder="e.g. 12" />
                </div>
                <div className="field">
                  <label>Width ({form.calculation_type === 'INCH' ? 'in' : 'ft'}) *</label>
                  <input name="width" type="number" inputMode="decimal"
                    value={form.width} onChange={handleFormChange} placeholder="e.g. 8" />
                </div>
              </div>
            )}
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_stock" checked={!!form.has_stock} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Manage Stock for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_remark" checked={!!form.has_remark} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Ask Remark / Extra Note for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_discount" checked={!!form.has_discount} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Allow Discount for this product
              </label>
            </div>
            {form.has_stock && (
              <div className="field">
                {editingId && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${stockMode === 'ADD' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setStockMode('ADD')}
                      style={{ flex: 1 }}
                    >
                      ➕ Add Stock (+)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${stockMode === 'SET' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setStockMode('SET')}
                      style={{ flex: 1 }}
                    >
                      ✏️ Set Exact (=)
                    </button>
                  </div>
                )}

                {editingId && stockMode === 'ADD' ? (
                  <>
                    <label>Quantity to Add (+)</label>
                    <input name="add_stock" type="number" inputMode="decimal"
                      value={form.add_stock} onChange={handleFormChange} placeholder="e.g. 10 to add 10 more" />
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 6, fontWeight: 700 }}>
                      Current: {form.stock || 0} → New Total: {Number(form.stock || 0) + (Number(form.add_stock) || 0)} {form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET' ? 'Nos.' : form.unit}
                    </div>
                  </>
                ) : (
                  <>
                    <label>{editingId ? 'Set Total Stock (=)' : 'Current Stock *'}</label>
                    <input name="stock" type="number" inputMode="decimal"
                      value={form.stock} onChange={handleFormChange} placeholder="e.g. 100" />
                    {editingId && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Current Stock in system: {form.stock || 0} {form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET' ? 'Nos.' : form.unit}
                      </div>
                    )}
                  </>
                )}

                <div style={{ marginTop: 12 }}>
                  <label>Minimum Stock Level * (Reorder Alert Limit)</label>
                  <input name="min_stock" type="number" inputMode="decimal"
                    value={form.min_stock} onChange={handleFormChange} placeholder="e.g. 5" />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Alert is triggered when stock falls below this quantity
                  </div>
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:10, marginTop:8 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update Product' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal-box">
            <div className="modal-title">Delete Product</div>
            <p style={{ marginBottom:16 }}>
              Delete <strong>{deleteConfirm.product_name}</strong>? Old estimates will not be affected.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-full" onClick={() => handleDelete(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {importDiscrepancies.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div className="modal-title">
              <span style={{ color: 'var(--warning-dark, #b54708)' }}>Data Discrepancy Report</span>
              <button className="btn btn-ghost" onClick={() => setImportDiscrepancies([])}>✕</button>
            </div>
            <div style={{ marginBottom: 16, fontSize: 14 }}>
              The database altered the following values during save. This usually happens if a number was rounded by the database schema.
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-50)' }}>
                    <th style={{ padding: '8px' }}>Product</th>
                    <th style={{ padding: '8px' }}>Field</th>
                    <th style={{ padding: '8px' }}>Raw (Sent)</th>
                    <th style={{ padding: '8px' }}>Saved (DB)</th>
                  </tr>
                </thead>
                <tbody>
                  {importDiscrepancies.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '8px' }}>{d.product_name}</td>
                      <td style={{ padding: '8px' }}>{d.field}</td>
                      <td style={{ padding: '8px', color: 'var(--danger)' }}>{d.expected}</td>
                      <td style={{ padding: '8px', color: 'var(--success)' }}>{d.saved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={() => setImportDiscrepancies([])}>
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowImport(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Import Products (CSV)</span>
              <button className="btn btn-ghost" onClick={() => setShowImport(false)}>✕</button>
            </div>
            <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:12 }}>
              Columns: <strong>Product Name, Length, Width, Unit, Rate, Calculation Type, Has Stock, Stock</strong><br />
              Leave Length/Width blank for QUANTITY products. "Has Stock" should be Yes/No.
            </p>
            <div className="field">
              <label>Upload CSV File</label>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileChange}
                style={{ padding:'10px 0', border:'none', fontSize:14 }} />
            </div>
            <div className="field">
              <label>Or Paste CSV Text</label>
              <textarea rows={5}
                style={{ width:'100%', padding:12, border:'2px solid var(--border-light)', borderRadius:8, fontSize:13, fontFamily:'monospace' }}
                placeholder={"C PLY 4 18 MM 7 x 4,7,4,Sq.Ft,57.50,SQFT\nNAILS 14 X 1 3/4,,,Kg.,130,QUANTITY"}
                value={importText}
                onChange={e => { setImportText(e.target.value); parseImport(e.target.value) }} />
            </div>
            {importPreview.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div className="section-label">
                  {importPreview.length} rows parsed 
                  {importPreview.some(r => r.errors?.length > 0) && <span style={{ color:'var(--danger)', marginLeft:8 }}>(Contains errors)</span>}
                </div>
                <div style={{ maxHeight:160, overflowY:'auto', fontSize:13 }}>
                  {importPreview.map((r,i) => (
                    <div key={i} style={{ padding:'6px 0', borderBottom:'1px solid #f0f0f0', color: r.errors?.length ? 'var(--danger)' : 'inherit' }}>
                      <strong>{r.product_name || 'Missing Name'}</strong> — {r.unit || 'No Unit'} @ ₹{r.raw_rate}
                      {r.calculation_type === 'SQFT' && ` (${r.length}×${r.width} ft)`}
                      {r.errors?.length > 0 && (
                        <div style={{ fontSize: 11, marginTop: 4 }}>
                          {r.errors.map((e, idx) => <div key={idx}>⚠ {e}</div>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleImport}
                disabled={saving || importPreview.length === 0 || importPreview.some(r => r.errors?.length > 0)}>
                {saving ? 'Importing...' : `Import ${importPreview.length} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ToastEl}
    </div>
  )
}
