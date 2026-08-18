import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast.jsx'
import { restoreStockForEstimates } from '../lib/stockUtils.js'
import { isFuzzyMatch } from '../lib/searchUtils'

export default function EstimateList() {
  const { role } = useAuth()
  const { showToast, ToastEl } = useToast()
  const navigate = useNavigate()
  const [allEstimates, setAllEstimates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
  const [convertingId, setConvertingId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [collapsedDates, setCollapsedDates] = useState(new Set())
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('tab')
    return p === 'quotations' ? 'QUOTATION' : p === 'returns' ? 'RETURN' : 'ESTIMATE'
  })

  const fetchEstimates = useCallback(async () => {
    setLoading(true)
    try {
      let from = 0
      let to = 999
      let allData = []

      while (true) {
        let query = supabase
          .from('estimates')
          .select('*')
          .order('bill_number', { ascending: false })
          .range(from, to)

        if (activeTab === 'QUOTATION') {
          query = query.eq('type', 'QUOTATION')
        } else if (activeTab === 'RETURN') {
          query = query.eq('type', 'RETURN')
        } else {
          query = query.or('type.eq.ESTIMATE,type.is.null')
        }

        const { data, error } = await query
        if (error) throw error

        if (data && data.length > 0) {
          allData = allData.concat(data)
        }
        if (!data || data.length < 1000) break

        from += 1000
        to += 1000
      }
      setAllEstimates(allData || [])
    } catch (error) {
      showToast('Failed to load records', 'error')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    const t = setTimeout(fetchEstimates, 300)
    return () => clearTimeout(t)
  }, [fetchEstimates])

  async function handleDelete(est) {
    setDeleting(true)

    if (est.type === 'QUOTATION' || !est.type) {
      await supabase.from('client_purchases').delete().eq('bill_number', est.bill_number);
      const { error } = await supabase.from('estimates').delete().eq('id', est.id)
      if (error) showToast('Delete failed: ' + error.message, 'error')
      else {
        showToast(`${est.type === 'QUOTATION' ? 'Quotation' : 'Bill'} #${est.bill_number} deleted`)
        fetchEstimates()
      }
    } else {
      // Restore stock before updating type
      await restoreStockForEstimates([est.id]);

      const newType = est.type === 'ESTIMATE' ? 'DELETED_ESTIMATE' : 'DELETED_RETURN';
      const { error } = await supabase.from('estimates').update({ type: newType }).eq('id', est.id)
      if (error) showToast('Delete failed: ' + error.message, 'error')
      else {
        showToast(`Bill #${est.bill_number} marked as deleted`)
        fetchEstimates()
      }
    }
    setDeleteConfirm(null)
    setDeleting(false)
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} selected estimates?`)) return

    setDeleting(true)
    const arr = Array.from(selectedIds)

    const { data: estsToDelete } = await supabase.from('estimates').select('id, type, bill_number').in('id', arr);

    if (estsToDelete && estsToDelete.length > 0) {
      const softDeleteIds = [];
      const hardDeleteIds = [];
      const hardDeleteBillNumbers = [];
      const returnSoftDeleteIds = [];

      for (const e of estsToDelete) {
        if (e.type === 'QUOTATION' || !e.type) {
          hardDeleteIds.push(e.id);
          hardDeleteBillNumbers.push(e.bill_number);
        } else if (e.type === 'RETURN') {
          returnSoftDeleteIds.push(e.id);
        } else {
          softDeleteIds.push(e.id);
        }
      }

      if (softDeleteIds.length > 0) {
        await restoreStockForEstimates(softDeleteIds);
        await supabase.from('estimates').update({ type: 'DELETED_ESTIMATE' }).in('id', softDeleteIds);
      }
      if (returnSoftDeleteIds.length > 0) {
        await restoreStockForEstimates(returnSoftDeleteIds);
        await supabase.from('estimates').update({ type: 'DELETED_RETURN' }).in('id', returnSoftDeleteIds);
      }
      if (hardDeleteIds.length > 0) {
        await supabase.from('client_purchases').delete().in('bill_number', hardDeleteBillNumbers);
        await supabase.from('estimates').delete().in('id', hardDeleteIds);
      }
    }

    showToast(`${arr.length} estimates deleted`)
    setSelectedIds(new Set())
    fetchEstimates()
    setDeleting(false)
  }

  async function handleQuickConvert(est) {
    if (!window.confirm(`Convert Quotation #${est.bill_number} to an Estimate? Stock will be deducted.`)) return
    setConvertingId(est.id)
    try {
      const { data: items } = await supabase.from('estimate_items').select('*').eq('estimate_id', est.id).order('serial_number')
      if (!items) throw new Error('Could not load items')

      const { data: allProducts } = await supabase.from('products').select('*')
      const prodMap = {}
      for (const p of (allProducts || [])) prodMap[p.id] = p

      for (const it of items) {
        if (it.product_id && prodMap[it.product_id] && prodMap[it.product_id].has_stock) {
          const p = prodMap[it.product_id]
          const reqQty = (it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET') ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
          const avail = Number(p.stock || 0)
          if (reqQty > avail) {
            showToast(`Cannot convert! Insufficient stock for ${p.product_name}. Required: ${reqQty} ${p.unit}, Available: ${avail} ${p.unit}.`, 'error')
            setConvertingId(null)
            return
          }
        }
      }

      for (const it of items) {
        if (it.product_id && prodMap[it.product_id] && prodMap[it.product_id].has_stock) {
          const qty = (it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET') ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
          if (qty > 0) {
            const p = prodMap[it.product_id]
            const newStock = Number(p.stock) - qty
            await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
            await supabase.from('stock_history').insert({
              product_id: p.id,
              change_type: 'QUOTATION_CONVERT',
              quantity_changed: -qty,
              estimate_id: est.id,
              bill_number: est.bill_number?.toString(),
              site_name: est.site_name
            })
          }
        }
      }

      let finalClientId = est.client_id || null;
      if (!finalClientId) {
        const cName = (est.client_name || est.transport || '').trim().toUpperCase();
        if (cName) {
          const { data: cData } = await supabase.from('clients').select('id').eq('name', cName).single();
          if (cData) {
            finalClientId = cData.id;
          }
        }
      }

      const { error } = await supabase.from('estimates').update({
        type: 'ESTIMATE',
        client_id: finalClientId,
        updated_at: new Date().toISOString()
      }).eq('id', est.id)

      if (error) throw error

      if (finalClientId) {
        const purchaseRecords = items.map(it => {
          const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
          const qty = isPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0);
          return {
            client_id: finalClientId,
            product_id: it.product_id || null,
            product_name: it.product_name_snapshot || 'Manual Item',
            quantity: qty,
            unit: isPieceBased ? 'Nos.' : (it.unit_snapshot || ''),
            rate: Number(it.rate) || 0,
            amount: Number(it.amount) || 0,
            bill_number: est.bill_number,
            bill_date: est.bill_date
          };
        }).filter(r => r.quantity > 0 || r.amount > 0);

        if (purchaseRecords.length > 0) {
          await supabase.from('client_purchases').delete().eq('bill_number', est.bill_number);
          await supabase.from('client_purchases').insert(purchaseRecords);
        }
      }

      showToast('Converted to Estimate & Stock Deducted ✓')
      fetchEstimates()
    } catch (e) {
      showToast('Conversion failed: ' + e.message, 'error')
    } finally {
      setConvertingId(null)
    }
  }

  function formatTotal(val) {
    return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })
  }

  const s = search.trim().toLowerCase()
  const sNoSpace = s.replace(/\s+/g, '')
  const searchTerms = s.split(/\s+/)
  const smartTerms = s.match(/[a-z]+|[0-9]+/g) || []

  const estimates = allEstimates.filter(est => {
    if (!s) return true
    const client = (est.client_name || '').toLowerCase()
    const site = (est.site_name || '').toLowerCase()
    const transport = (est.transport || '').toLowerCase()
    const bNum = est.bill_number?.toString() || ''

    const targetStr = `${client} ${site} ${transport} ${bNum}`
    const targetNoSpace = targetStr.replace(/\s+/g, '')

    const matchesAllTerms = searchTerms.every(term => targetStr.includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => targetStr.includes(term))

    return targetStr.includes(s) ||
      targetNoSpace.includes(sNoSpace) ||
      matchesAllTerms ||
      matchesSmartTerms ||
      isFuzzyMatch(sNoSpace, client) ||
      isFuzzyMatch(sNoSpace, site) ||
      isFuzzyMatch(sNoSpace, bNum)
  })

  const groupedEstimates = {}
  for (const est of estimates) {
    if (!groupedEstimates[est.bill_date]) groupedEstimates[est.bill_date] = []
    groupedEstimates[est.bill_date].push(est)
  }

  function parseDate(dateStr) {
    if (!dateStr) return new Date(0)
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`)
    }
    return new Date(dateStr)
  }

  // Sort dates descending
  const dates = Object.keys(groupedEstimates).sort((a, b) => parseDate(b) - parseDate(a))

  const allSelected = estimates.length > 0 && selectedIds.size === estimates.length
  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(estimates.map(e => e.id)))
  }

  function toggleSelectDate(date) {
    const dateEsts = groupedEstimates[date]
    const allInDateSelected = dateEsts.every(e => selectedIds.has(e.id))
    const next = new Set(selectedIds)
    if (allInDateSelected) {
      dateEsts.forEach(e => next.delete(e.id))
    } else {
      dateEsts.forEach(e => next.add(e.id))
    }
    setSelectedIds(next)
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function toggleCollapse(date) {
    const next = new Set(collapsedDates)
    if (next.has(date)) next.delete(date)
    else next.add(date)
    setCollapsedDates(next)
  }

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">{activeTab === 'QUOTATION' ? 'Previous Quotations' : activeTab === 'RETURN' ? 'Previous Returns' : 'Previous Estimates'}</span>
      </div>

      <div className="page">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${activeTab === 'ESTIMATE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => {
              setActiveTab('ESTIMATE')
              window.history.replaceState(null, '', '?tab=estimates')
            }}
          >
            📄 Estimates {activeTab === 'ESTIMATE' && `(${estimates.length})`}
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'QUOTATION' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => {
              setActiveTab('QUOTATION')
              window.history.replaceState(null, '', '?tab=quotations')
            }}
          >
            📜 Quotations {activeTab === 'QUOTATION' && `(${estimates.length})`}
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'RETURN' ? 'btn-danger' : 'btn-secondary'}`}
            style={{ flex: 1, background: activeTab === 'RETURN' ? '#dc2626' : undefined, color: activeTab === 'RETURN' ? '#fff' : undefined }}
            onClick={() => {
              setActiveTab('RETURN')
              window.history.replaceState(null, '', '?tab=returns')
            }}
          >
            ↩️ Returns {activeTab === 'RETURN' && `(${estimates.length})`}
          </button>
        </div>

        {/* Search */}
        <div className="search-bar">
          <span>🔍</span>
          <input
            placeholder={`Search ${activeTab === 'QUOTATION' ? 'quotations' : activeTab === 'RETURN' ? 'returns' : 'estimates'} by number, site or client...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <span className="section-label">{estimates.length} Estimate{estimates.length !== 1 ? 's' : ''}</span>
          {estimates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ width: 16, height: 16 }} />
                Select All
              </label>
              {selectedIds.size > 0 && role === 'ADMIN' && (
                <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected}>
                  🗑 Delete ({selectedIds.size})
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="spinner" />
        ) : estimates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗂️</div>
            <p>{search ? 'No estimates match your search' : 'No estimates yet. Create your first one!'}</p>
          </div>
        ) : (
          dates.map(date => {
            const dateEsts = groupedEstimates[date]
            const isCollapsed = collapsedDates.has(date)
            const allInDateSelected = dateEsts.every(e => selectedIds.has(e.id))
            return (
              <div key={date} style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '4px 8px', background: 'var(--surface-color)', borderRadius: 8 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px', minWidth: 'auto' }} onClick={() => toggleCollapse(date)}>
                    {isCollapsed ? '▶' : '▼'}
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', margin: 0, fontWeight: 600 }}>
                    <input type="checkbox" checked={allInDateSelected} onChange={() => toggleSelectDate(date)} style={{ width: 16, height: 16 }} />
                    {parseDate(date).toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>({dateEsts.length})</span>
                  </label>
                </div>
                {!isCollapsed && dateEsts.map(est => (
                  <div key={est.id} className="estimate-row" style={{ border: selectedIds.has(est.id) ? '2px solid var(--primary-color)' : '1px solid var(--border-light)', cursor: 'pointer' }} onClick={() => navigate(`/estimate/view/${est.id}`)}>
                    <div className="est-header">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <input type="checkbox" checked={selectedIds.has(est.id)} onChange={() => toggleSelect(est.id)} onClick={(e) => e.stopPropagation()} style={{ width: 18, height: 18, marginTop: 4, cursor: 'pointer' }} />
                        <div>
                          <div className="est-bill" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            Bill #{est.bill_number}
                            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>
                              {est.bill_date.replace(/-/g, '/')}
                            </span>
                          </div>
                          <div className="est-meta" style={{ color: 'var(--text-color)', fontWeight: 500 }}>
                            {(est.client_name || est.transport) ? `👤 ${est.client_name || est.transport}` : ''}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>📍 {est.site_name}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="est-total">₹{formatTotal(est.grand_total)}</div>
                      </div>
                    </div>

                    <div className="est-actions" style={{ marginLeft: 30 }}>
                      <button className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/estimate/view/${est.id}`); }}>
                        👁 View
                      </button>
                      <button className="btn btn-primary btn-sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/estimate/edit/${est.id}`); }}>
                        ✏️ Edit
                      </button>
                      {activeTab === 'QUOTATION' ? (
                        <button className="btn btn-primary btn-sm"
                          style={{ background: 'var(--success-color, #10b981)', border: 'none', color: '#fff' }}
                          disabled={convertingId === est.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickConvert(est);
                          }}>
                          {convertingId === est.id ? '🔄...' : '🔄 Estimate'}
                        </button>
                      ) : (
                        <button className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/estimate/view/${est.id}`)
                            setTimeout(() => window.print(), 800)
                          }}>
                          🖨 Print
                        </button>
                      )}
                      {role === 'ADMIN' && (
                        <button className="btn btn-danger btn-sm"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(est); }}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })
        )}
      </div>

      {/* Sticky new estimate button */}
      <div className="sticky-bottom">
        <div className="sticky-bottom-inner">
          <button className="btn btn-primary btn-full btn-lg"
            onClick={() => navigate('/estimate/new')}>
            + CREATE NEW ESTIMATE
          </button>
        </div>
      </div>

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="modal-overlay"
          onClick={e => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal-box">
            <div className="modal-title">Delete Estimate</div>
            <p style={{ marginBottom: 8 }}>
              Delete <strong>Bill #{deleteConfirm.bill_number}</strong>?
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Site: {deleteConfirm.site_name} · ₹{formatTotal(deleteConfirm.grand_total)}<br />
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary btn-full"
                onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-full"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}>
                {deleting ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ToastEl}
    </div>
  )
}
