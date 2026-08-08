import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast.jsx'
import { isFuzzyMatch } from '../lib/searchUtils'

export default function StockReport() {
  const navigate = useNavigate()
  const { showToast, ToastEl } = useToast()
  const [products, setProducts] = useState([])
  const [history, setHistory] = useState([])
  const [salesItems, setSalesItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('ALL')
  const [datePreset, setDatePreset] = useState('ALL') // ALL, TODAY, 7DAYS, 15DAYS, 30DAYS, CUSTOM
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('tab')
    return p === 'reorder' ? 'reorder' : (p === 'history' ? 'history' : 'summary')
  })

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      async function fetchAll(table, select, applyModifiers = q => q) {
        let allData = []
        let from = 0
        let to = 999
        while (true) {
          let query = supabase.from(table).select(select).range(from, to)
          query = applyModifiers(query)
          const { data, error } = await query
          if (error) throw error
          if (data && data.length > 0) {
            allData = allData.concat(data)
          }
          if (!data || data.length < 1000) break
          from += 1000
          to += 1000
        }
        return allData
      }

      const prods = await fetchAll('products', '*', q => q.order('product_name'))
      
      const hist = await fetchAll('stock_history', '*, products(product_name, unit, calculation_type), estimates(bill_number, site_name, type)', q => q.order('created_at', { ascending: false }))
      
      const sales = await fetchAll('estimate_items', 'product_id, quantity, nos, calculation_type_snapshot, estimates!inner(created_at, type)', q => q.eq('estimates.type', 'ESTIMATE'))

      setProducts(prods || [])
      setHistory(hist || [])
      setSalesItems(sales || [])
    } catch (e) {
      showToast('Failed to load report data: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Date filtering logic
  const getDisplayUnit = (p) => {
    if (!p) return '';
    const calc = p.calculation_type;
    if (calc === 'SQFT' || calc === 'INCH' || calc === 'FEET') return 'Nos.';
    return p.unit || '';
  }

  function isWithinDateRange(isoStr) {
    if (!isoStr) return false
    if (datePreset === 'ALL') return true

    const eventTime = new Date(isoStr).getTime()
    const now = new Date()

    if (datePreset === 'TODAY') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      return eventTime >= startOfDay
    }
    if (datePreset === '7DAYS') {
      const cutoff = now.getTime() - (7 * 24 * 60 * 60 * 1000)
      return eventTime >= cutoff
    }
    if (datePreset === '15DAYS') {
      const cutoff = now.getTime() - (15 * 24 * 60 * 60 * 1000)
      return eventTime >= cutoff
    }
    if (datePreset === '30DAYS') {
      const cutoff = now.getTime() - (30 * 24 * 60 * 60 * 1000)
      return eventTime >= cutoff
    }
    if (datePreset === 'CUSTOM') {
      let valid = true
      if (fromDate) {
        const start = new Date(`${fromDate}T00:00:00`).getTime()
        if (eventTime < start) valid = false
      }
      if (toDate) {
        const end = new Date(`${toDate}T23:59:59`).getTime()
        if (eventTime > end) valid = false
      }
      return valid
    }
    return true
  }

  function getDateRangeLabel() {
    if (datePreset === 'ALL') return 'All Time'
    if (datePreset === 'TODAY') return 'Today'
    if (datePreset === '7DAYS') return 'Last 7 Days'
    if (datePreset === '15DAYS') return 'Last 15 Days'
    if (datePreset === '30DAYS') return 'Last 30 Days (Last Month)'
    if (datePreset === 'CUSTOM') return `${fromDate || 'Start'} to ${toDate || 'End'}`
    return 'All Time'
  }

  // Filtered products with stock tracking enabled
  const trackedProducts = products

  // Calculate per-product statistics filtered by date range
  const productStats = {}
  let inStockCount = 0
  let lowStockCount = 0
  let outOfStockCount = 0

  const allLowStockProducts = trackedProducts.filter(p => {
    if (!p.has_stock) return false
    const stock = Number(p.stock || 0)
    const minReq = Number(p.min_stock ?? 5)
    return stock < minReq
  })

  for (const p of trackedProducts) {
    if (p.has_stock) {
      const stock = Number(p.stock || 0)
      const minReq = Number(p.min_stock ?? 5)
      if (stock <= 0) outOfStockCount++
      else if (stock < minReq) lowStockCount++
      else inStockCount++
    }
    productStats[p.id] = { added: 0, sold: 0 }
  }

  // Filter history by date range first
  const dateFilteredHistory = history.filter(h => isWithinDateRange(h.created_at))

  for (const h of dateFilteredHistory) {
    const qty = Number(h.quantity_changed || 0)
    const type = h.change_type
    
    if (productStats[h.product_id]) {
      const p = trackedProducts.find(x => x.id === h.product_id)
      if (p && p.has_stock) {
        if (type === 'MANUAL_ADJUST' && qty > 0) {
          productStats[h.product_id].added += qty
        } else if (type === 'ESTIMATE_DEDUCT' || type === 'QUOTATION_CONVERT') {
          productStats[h.product_id].sold += Math.abs(qty)
        } else if (type === 'RETURN_ADD' || type === 'ESTIMATE_DELETED_RESTORE' || type === 'REVERT_TO_QUOTATION') {
          productStats[h.product_id].sold -= Math.abs(qty) // Net sales reduced by return
        } else if (type === 'MANUAL_ADJUST' && qty < 0) {
          productStats[h.product_id].sold += Math.abs(qty) // Manual deduction
        } else if (type === 'RETURN_UPDATE' || type === 'ESTIMATE_UPDATE') {
          if (qty < 0) {
            productStats[h.product_id].sold += Math.abs(qty)
          } else {
            productStats[h.product_id].sold -= Math.abs(qty)
          }
        }
      }
    }
  }

  // Filter sales by date range
  const dateFilteredSales = salesItems.filter(s => isWithinDateRange(s.estimates?.created_at))

  for (const s of dateFilteredSales) {
    if (productStats[s.product_id]) {
      const p = trackedProducts.find(x => x.id === s.product_id)
      if (p && !p.has_stock) {
        const isPieceBased = s.calculation_type_snapshot === 'SQFT' || s.calculation_type_snapshot === 'INCH' || s.calculation_type_snapshot === 'FEET'
        const qty = isPieceBased ? (Number(s.nos) || 0) : (Number(s.quantity) || 0)
        productStats[s.product_id].sold += qty
      }
    }
  }

  // Filtered lists based on search & product dropdown
  const s = search.trim().toLowerCase()
  const searchTerms = s.split(/\s+/)
  const smartTerms = s.match(/[a-z]+|[0-9]+/g) || []

  const filteredProducts = trackedProducts.filter(p => {
    const pName = p.product_name.toLowerCase()
    const matchesAllTerms = searchTerms.every(term => pName.includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.includes(term))
    const sNoSpace = s.replace(/\s+/g, '')
    const matchesSearch = pName.includes(s) || matchesAllTerms || matchesSmartTerms || pName.replace(/\s+/g, '').includes(sNoSpace) || isFuzzyMatch(sNoSpace, pName)
    const matchesSelect = selectedProductId === 'ALL' || p.id === selectedProductId
    return matchesSearch && matchesSelect
  })

  const filteredLowStockProducts = allLowStockProducts.filter(p => {
    const pName = p.product_name.toLowerCase()
    const matchesAllTerms = searchTerms.every(term => pName.includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.includes(term))
    const sNoSpace = s.replace(/\s+/g, '')
    const matchesSearch = pName.includes(s) || matchesAllTerms || matchesSmartTerms || pName.replace(/\s+/g, '').includes(sNoSpace) || isFuzzyMatch(sNoSpace, pName)
    const matchesSelect = selectedProductId === 'ALL' || p.id === selectedProductId
    return matchesSearch && matchesSelect
  })

  const filteredHistory = dateFilteredHistory.filter(h => {
    const matchesProduct = selectedProductId === 'ALL' || h.product_id === selectedProductId
    const pName = h.products?.product_name || ''
    const bNum = h.bill_number || h.estimates?.bill_number?.toString() || ''
    const site = h.site_name || h.estimates?.site_name || ''
    const matchesAllTerms = searchTerms.every(term => pName.toLowerCase().includes(term) || bNum.includes(term) || site.toLowerCase().includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.toLowerCase().includes(term) || bNum.includes(term) || site.toLowerCase().includes(term))
    const sNoSpace = s.replace(/\s+/g, '')
    const matchesSearch = pName.toLowerCase().includes(s) || bNum.includes(s) || site.toLowerCase().includes(s) || matchesAllTerms || matchesSmartTerms || pName.toLowerCase().replace(/\s+/g, '').includes(sNoSpace) || isFuzzyMatch(sNoSpace, pName) || isFuzzyMatch(sNoSpace, site)
    return matchesProduct && matchesSearch
  })

  function formatDate(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    })
  }

  function getChangeLabel(h) {
    const type = h.change_type;
    const b = h.bill_number || h.estimates?.bill_number || '';
    if (type === 'MANUAL_ADJUST') return h.quantity_changed > 0 ? 'Stock Added' : 'Manual Adjustment'
    if (type === 'ESTIMATE_DEDUCT') return `Estimate #${b}`
    if (type === 'QUOTATION_CONVERT') return `Quote Converted #${b}`
    if (type === 'ESTIMATE_UPDATE') return `Estimate Updated #${b}`
    if (type === 'RETURN_ADD') return `Sales Return #${b}`
    if (type === 'RETURN_UPDATE') return `Sales Return Updated #${b}`
    if (type === 'ESTIMATE_DELETED_RESTORE') return `Estimate Deleted - Stock Restored #${b}`
    if (type === 'REVERT_TO_QUOTATION') return `Reverted to Quote - Stock Restored #${b}`
    return type
  }

  // Excel (.xlsx) Multi-Sheet Export Generator
  async function handleExportExcel() {
    try {
      showToast('Generating Excel report...', 'info')
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      const rangeText = getDateRangeLabel()

      // Sheet 1: Product Register Summary
      const summaryRows = [
        ['STOCK MOVEMENT REPORT - SUMMARY'],
        [`Date Filter: ${rangeText}`],
        [`Generated On: ${new Date().toLocaleString('en-IN')}`],
        [],
        ['Product Name', 'Unit', `Added (+ in ${rangeText})`, `Sold (- in ${rangeText})`, 'Current Balance Stock', 'Min. Required Stock']
      ]

      for (const p of filteredProducts) {
        const stats = productStats[p.id] || { added: 0, sold: 0 }
        summaryRows.push([
          p.product_name,
          getDisplayUnit(p),
          stats.added,
          stats.sold,
          p.stock || 0,
          p.min_stock ?? 5
        ])
      }

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
      wsSummary['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 22 }]
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Product Summary')

      // Sheet 2: Reorder / Low Stock Alerts
      const reorderRows = [
        ['LOW STOCK REORDER ALERTS (Stock < Minimum Required)'],
        [`Generated On: ${new Date().toLocaleString('en-IN')}`],
        [],
        ['Product Name', 'Unit', 'Min. Required Stock', 'Current Stock', 'Reorder Deficit Qty', 'Alert Status']
      ]

      for (const p of filteredLowStockProducts) {
        const stock = Number(p.stock || 0)
        const minReq = Number(p.min_stock ?? 5)
        const deficit = Math.max(0, minReq - stock)
        const status = stock <= 0 ? 'CRITICAL OUT OF STOCK' : 'REORDER NEEDED'
        reorderRows.push([
          p.product_name,
          p.unit,
          minReq,
          stock,
          deficit,
          status
        ])
      }

      const wsReorder = XLSX.utils.aoa_to_sheet(reorderRows)
      wsReorder['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 28 }]
      XLSX.utils.book_append_sheet(wb, wsReorder, 'Low Stock Alerts')

      // Sheet 3: Detailed Movement Audit Log
      const historyRows = [
        ['STOCK MOVEMENT REPORT - AUDIT LOG'],
        [`Date Filter: ${rangeText}`],
        [`Generated On: ${new Date().toLocaleString('en-IN')}`],
        [],
        ['Date & Time', 'Product Name', 'Activity Type', 'Site Reference', 'Quantity Changed', 'Unit']
      ]

      for (const h of filteredHistory) {
        const qty = Number(h.quantity_changed || 0)
        historyRows.push([
          formatDate(h.created_at),
          h.products?.product_name || '',
          getChangeLabel(h),
          h.site_name || h.estimates?.site_name || '',
          qty > 0 ? `+${qty}` : qty,
          getDisplayUnit(h.products)
        ])
      }

      const wsHistory = XLSX.utils.aoa_to_sheet(historyRows)
      wsHistory['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 28 }, { wch: 20 }, { wch: 18 }, { wch: 10 }]
      XLSX.utils.book_append_sheet(wb, wsHistory, 'Movement Audit Log')

      // Download file
      const rangeName = datePreset === 'CUSTOM' ? `${fromDate || 'start'}_to_${toDate || 'end'}` : datePreset
      XLSX.writeFile(wb, `Stock-Report-${rangeName}.xlsx`)
      showToast('Excel report (.xlsx) downloaded ✓', 'success')
    } catch (e) {
      showToast('Excel export failed: ' + e.message, 'error')
    }
  }

  return (
    <div className="app-container">
      {/* Nav */}
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">📊 Stock Movement Report</span>
        <button
          className="btn btn-sm"
          style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
          onClick={handleExportExcel}
        >
          📊 Export Excel
        </button>
      </div>

      <div className="page">

        {/* Date Range Selection Box */}
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>📅 Filter by Date Range</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              className={`btn btn-sm ${datePreset === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('ALL')}
            >
              All Time
            </button>
            <button
              className={`btn btn-sm ${datePreset === 'TODAY' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('TODAY')}
            >
              Today
            </button>
            <button
              className={`btn btn-sm ${datePreset === '7DAYS' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('7DAYS')}
            >
              Last 7 Days
            </button>
            <button
              className={`btn btn-sm ${datePreset === '15DAYS' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('15DAYS')}
            >
              Last 15 Days
            </button>
            <button
              className={`btn btn-sm ${datePreset === '30DAYS' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('30DAYS')}
              style={{ gridColumn: 'span 2' }}
            >
              Last 30 Days (Last Month)
            </button>
            <button
              className={`btn btn-sm ${datePreset === 'CUSTOM' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDatePreset('CUSTOM')}
              style={{ gridColumn: 'span 2' }}
            >
              🗓️ Custom Date Range
            </button>
          </div>

          {datePreset === 'CUSTOM' && (
            <div className="field-row" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>From Date</label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>To Date</label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Overview Status Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div className="card" style={{ padding: 12, background: '#eff6ff', border: '1px solid #93c5fd', marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase' }}>📦 Tracked Items</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1d4ed8', marginTop: 2 }}>{trackedProducts.length}</div>
          </div>

          <div className="card" style={{ padding: 12, background: '#ecfdf5', border: '1px solid #6ee7b7', marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase' }}>🟢 In Stock</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#047857', marginTop: 2 }}>{inStockCount}</div>
          </div>

          <div className="card" style={{ padding: 12, background: '#fefce8', border: '1px solid #fde047', marginBottom: 0, cursor: 'pointer' }} onClick={() => setActiveTab('reorder')}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#854d0e', textTransform: 'uppercase' }}>⚠️ Low Stock Alert</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#a16207', marginTop: 2 }}>{allLowStockProducts.length}</div>
          </div>

          <div className="card" style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', marginBottom: 0, cursor: 'pointer' }} onClick={() => setActiveTab('reorder')}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>🔴 Out of Stock</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#b91c1c', marginTop: 2 }}>{outOfStockCount}</div>
          </div>
        </div>

        {/* Tab Toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button
            className={`btn btn-sm ${activeTab === 'summary' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '8px 4px', fontSize: 12 }}
            onClick={() => setActiveTab('summary')}
          >
            📦 Register
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'reorder' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '8px 4px', fontSize: 12, color: activeTab !== 'reorder' && allLowStockProducts.length > 0 ? '#b91c1c' : undefined, fontWeight: allLowStockProducts.length > 0 ? 700 : 400 }}
            onClick={() => setActiveTab('reorder')}
          >
            ⚠️ Low Stock ({allLowStockProducts.length})
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, padding: '8px 4px', fontSize: 12 }}
            onClick={() => setActiveTab('history')}
          >
            📜 Log ({filteredHistory.length})
          </button>
        </div>

        {/* Filters */}
        <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select
            className="field select"
            style={{ margin: 0, padding: 10, fontSize: 14 }}
            value={selectedProductId}
            onChange={e => setSelectedProductId(e.target.value)}
          >
            <option value="ALL">All Stock-Managed Products ({trackedProducts.length})</option>
            {trackedProducts.map(p => (
              <option key={p.id} value={p.id}>{p.product_name} (Stock: {p.stock} / Min: {p.min_stock ?? 5} {getDisplayUnit(p)})</option>
            ))}
          </select>

          <div className="search-bar" style={{ margin: 0 }}>
            <span>🔍</span>
            <input
              placeholder="Search product"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="spinner" />
        ) : activeTab === 'summary' ? (

          /* Product Stock Register Table */
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: '#f5f5f0', fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border-light)', color: 'var(--text-muted)' }}>
              FILTERED PERIOD: {getDateRangeLabel()}
            </div>
            {filteredProducts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                No matching stock-managed products found.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderBottom: '2px solid var(--border-light)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Product</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', color: '#047857' }}>Added</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', color: '#b91c1c' }}>Sold</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Current / Min</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const stats = productStats[p.id] || { added: 0, sold: 0 }
                    const stock = Number(p.stock || 0)
                    const minReq = Number(p.min_stock ?? 5)
                    const isLow = stock < minReq && stock > 0
                    const isOut = stock <= 0

                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 700 }}>{p.product_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unit: {getDisplayUnit(p)}</div>
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#047857' }}>
                          {stats.added === 0 ? '0' : stats.added > 0 ? `+${stats.added}` : stats.added}
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#b91c1c' }}>
                          {stats.sold === 0 ? '0' : stats.sold > 0 ? `-${stats.sold}` : `+${Math.abs(stats.sold)}`}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {!p.has_stock ? (
                            <div style={{ color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic' }}>
                              Not Tracked
                            </div>
                          ) : (
                            <>
                              <div style={{
                                fontWeight: 700,
                                fontSize: 14,
                                color: isOut ? '#dc2626' : isLow ? '#d97706' : '#166534'
                              }}>
                                {stock} {getDisplayUnit(p)}
                              </div>
                              <div style={{ fontSize: 10, color: '#666' }}>Min: {minReq}</div>
                              {isOut ? (
                                <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: 10 }}>OUT OF STOCK</span>
                              ) : isLow ? (
                                <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}>LOW STOCK</span>
                              ) : (
                                <span className="badge" style={{ background: '#d1fae5', color: '#047857', fontSize: 10 }}>IN STOCK</span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

        ) : activeTab === 'reorder' ? (

          /* Low Stock / Reorder Alert Tabular View */
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: '#fef2f2', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #fca5a5', color: '#991b1b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>⚠️ REORDER ALERT LIST (Stock &lt; Minimum Required)</span>
              <span className="badge" style={{ background: '#dc2626', color: '#fff' }}>{filteredLowStockProducts.length} Items</span>
            </div>
            {filteredLowStockProducts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#047857', fontWeight: 600 }}>
                🎉 Great news! All products have sufficient stock above minimum required levels.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fff5f5', borderBottom: '2px solid #fca5a5' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Product Name</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', color: '#b91c1c' }}>Min Req.</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', color: '#dc2626' }}>Current</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', color: '#991b1b' }}>Deficit</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLowStockProducts.map(p => {
                    const stock = Number(p.stock || 0)
                    const minReq = Number(p.min_stock ?? 5)
                    const deficit = Math.max(0, minReq - stock)
                    const isOut = stock <= 0

                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #fee2e2', background: isOut ? '#fff5f5' : '#fff' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 700, color: isOut ? '#dc2626' : '#111827' }}>{p.product_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Unit: {getDisplayUnit(p)}</div>
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600 }}>
                          {minReq}
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: isOut ? '#dc2626' : '#d97706' }}>
                          {stock}
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 700, color: '#991b1b' }}>
                          +{deficit} {getDisplayUnit(p)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={() => navigate(`/products?editId=${p.id}`)}
                          >
                            ➕ Add Stock
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

        ) : (

          /* Detailed Movement Audit Log */
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
              SHOWING MOVEMENTS FOR: {getDateRangeLabel()}
            </div>
            {filteredHistory.length === 0 ? (
              <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                No stock movement transactions recorded for this period.
              </div>
            ) : (
              filteredHistory.map(h => {
                const qty = Number(h.quantity_changed || 0)
                const isPositive = qty > 0

                return (
                  <div key={h.id} className="card" style={{ padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {h.products?.product_name || 'Product'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {getChangeLabel(h)} {h.site_name || h.estimates?.site_name ? `(${h.site_name || h.estimates.site_name})` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {formatDate(h.created_at)}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: isPositive ? '#047857' : '#b91c1c'
                      }}>
                        {isPositive ? `+${qty}` : qty} {getDisplayUnit(h.products)}
                      </div>
                      {h.estimate_id && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 6px', fontSize: 11, marginTop: 4 }}
                          onClick={() => navigate(`/estimate/view/${h.estimate_id}`)}
                        >
                          View Bill →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

      </div>
      {ToastEl}
    </div>
  )
}
