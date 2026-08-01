import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast.jsx'
import { isFuzzyMatch } from '../lib/searchUtils'

export default function EstimateList() {
  const { showToast, ToastEl } = useToast()
  const navigate = useNavigate()
  const [allEstimates, setAllEstimates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleting, setDeleting] = useState(false)
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
    
    if (est.type === 'ESTIMATE' && est.client_id) {
      await supabase.from('payments').insert({
        client_id: est.client_id,
        payment_date: est.bill_date,
        amount: -Math.abs(est.grand_total || 0),
        description: `Bill #${est.bill_number} (Preserved Balance)`,
        payment_mode: ''
      })
    } else if (est.type === 'RETURN' && est.client_id) {
      await supabase.from('payments').insert({
        client_id: est.client_id,
        payment_date: est.bill_date,
        amount: Math.abs(est.grand_total || 0),
        description: `Return #${est.bill_number} (Preserved Balance)`,
        payment_mode: ''
      })
    }

    // also delete from client_purchases
    await supabase.from('client_purchases').delete().eq('bill_number', est.bill_number);

    // items cascade-delete via FK
    const { error } = await supabase.from('estimates').delete().eq('id', est.id)
    if (error) showToast('Delete failed: ' + error.message, 'error')
    else {
      showToast(`Bill #${est.bill_number} deleted`)
      fetchEstimates()
    }
    setDeleteConfirm(null)
    setDeleting(false)
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} selected estimates?`)) return
    
    setDeleting(true)
    const arr = Array.from(selectedIds)
    
    // get full estimates for these IDs to preserve ledger
    const { data: estsToPreserve } = await supabase.from('estimates').select('*').in('id', arr).in('type', ['ESTIMATE', 'RETURN']).not('client_id', 'is', null)
    
    if (estsToPreserve && estsToPreserve.length > 0) {
      const inserts = estsToPreserve.map(e => {
        const isReturn = e.type === 'RETURN';
        return {
          client_id: e.client_id,
          payment_date: e.bill_date,
          amount: isReturn ? Math.abs(e.grand_total || 0) : -Math.abs(e.grand_total || 0),
          description: isReturn ? `Return #${e.bill_number} (Preserved Balance)` : `Bill #${e.bill_number} (Preserved Balance)`,
          payment_mode: ''
        };
      })
      await supabase.from('payments').insert(inserts)
    }

    // delete client purchases for selected estimates
    const { data: estsToDelete } = await supabase.from('estimates').select('bill_number').in('id', arr);
    if (estsToDelete && estsToDelete.length > 0) {
      const billNumbers = estsToDelete.map(e => e.bill_number);
      await supabase.from('client_purchases').delete().in('bill_number', billNumbers);
    }

    const { error } = await supabase.from('estimates').delete().in('id', arr)
    if (error) showToast('Batch delete failed: ' + error.message, 'error')
    else {
      showToast(`${arr.length} estimates deleted`)
      setSelectedIds(new Set())
      fetchEstimates()
    }
    setDeleting(false)
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
        <button className="nav-back" onClick={() => navigate('/')}>←</button>
        <span className="nav-title">{activeTab === 'QUOTATION' ? 'Previous Quotations' : activeTab === 'RETURN' ? 'Previous Returns' : 'Previous Estimates'}</span>
      </div>

      <div className="page">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            className={`btn btn-sm ${activeTab === 'ESTIMATE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => {
              setActiveTab('ESTIMATE')
              window.history.replaceState(null, '', '?tab=estimates')
            }}
          >
            📄 Estimates ({activeTab === 'ESTIMATE' ? estimates.length : 'Bills'})
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'QUOTATION' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => {
              setActiveTab('QUOTATION')
              window.history.replaceState(null, '', '?tab=quotations')
            }}
          >
            📜 Quotations ({activeTab === 'QUOTATION' ? estimates.length : 'Quotes'})
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'RETURN' ? 'btn-danger' : 'btn-secondary'}`}
            style={{ flex: 1, background: activeTab === 'RETURN' ? '#dc2626' : undefined, color: activeTab === 'RETURN' ? '#fff' : undefined }}
            onClick={() => {
              setActiveTab('RETURN')
              window.history.replaceState(null, '', '?tab=returns')
            }}
          >
            ↩️ Returns ({activeTab === 'RETURN' ? estimates.length : 'Returns'})
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="section-label">{estimates.length} Estimate{estimates.length !== 1 ? 's' : ''}</span>
          {estimates.length > 0 && (
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
                  <div key={est.id} className="estimate-row" style={{ border: selectedIds.has(est.id) ? '2px solid var(--primary-color)' : '1px solid var(--border-light)' }}>
                    <div className="est-header">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <input type="checkbox" checked={selectedIds.has(est.id)} onChange={() => toggleSelect(est.id)} style={{ width: 18, height: 18, marginTop: 4, cursor: 'pointer' }} />
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
                        onClick={() => navigate(`/estimate/view/${est.id}`)}>
                        👁 View
                      </button>
                      <button className="btn btn-primary btn-sm"
                        onClick={() => navigate(`/estimate/edit/${est.id}`)}>
                        ✏️ Edit
                      </button>
                      <button className="btn btn-secondary btn-sm"
                        onClick={() => {
                          navigate(`/estimate/view/${est.id}`)
                          setTimeout(() => window.print(), 800)
                        }}>
                        🖨 Print
                      </button>
                      <button className="btn btn-danger btn-sm"
                        onClick={() => setDeleteConfirm(est)}>
                        🗑
                      </button>
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
