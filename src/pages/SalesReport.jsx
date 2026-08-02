import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast.jsx'

function getNormalizedDateString(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).split('T')[0];
  const parts = s.replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}

export default function SalesReport() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [expandedRows, setExpandedRows] = useState(new Set())

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: purchases, error } = await supabase
      .from('client_purchases')
      .select(`
        *,
        clients!inner(name),
        products(product_group)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      showToast('Failed to load sales data: ' + error.message, 'error')
    } else {
      setData(purchases || [])
    }
    setLoading(false)
  }

  const groupedData = useMemo(() => {
    const map = new Map()
    const query = search.toLowerCase().trim()
    const fd = fromDate || null
    const td = toDate || null

    data.forEach(p => {
      const pDateStr = getNormalizedDateString(p.bill_date || p.created_at)
      if (fd && pDateStr < fd) return
      if (td && pDateStr > td) return

      const clientName = p.clients?.name || 'Unknown Client'
      const productName = p.product_name || 'Manual Item'
      const groupName = p.products?.product_group || 'Uncategorized'

      if (query && !clientName.toLowerCase().includes(query) && !productName.toLowerCase().includes(query) && !groupName.toLowerCase().includes(query)) {
        return
      }

      const key = `${clientName}|||${groupName}`
      if (!map.has(key)) {
        map.set(key, {
          clientName,
          groupName,
          totalQty: 0,
          totalAmount: 0,
          productsMap: new Map() // product_name -> { totalQty, totalAmount, unit }
        })
      }

      const group = map.get(key)
      group.totalQty += Number(p.quantity) || 0
      group.totalAmount += Number(p.amount) || 0

      if (!group.productsMap.has(productName)) {
        group.productsMap.set(productName, {
          name: productName,
          totalQty: 0,
          totalAmount: 0,
          unit: p.unit || ''
        })
      }
      
      const prod = group.productsMap.get(productName)
      prod.totalQty += Number(p.quantity) || 0
      prod.totalAmount += Number(p.amount) || 0
      if (!prod.unit && p.unit) prod.unit = p.unit
    })

    // Convert to array and sort by Client Name, then Group Name
    const result = Array.from(map.values()).map(g => ({
      ...g,
      products: Array.from(g.productsMap.values()).sort((a, b) => b.totalAmount - a.totalAmount)
    }))
    
    return result.sort((a, b) => {
      const c = a.clientName.localeCompare(b.clientName)
      if (c !== 0) return c
      return a.groupName.localeCompare(b.groupName)
    })
  }, [data, search, fromDate, toDate])

  const toggleExpand = (key) => {
    const next = new Set(expandedRows)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedRows(next)
  }

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate('/')}>←</button>
        <span className="nav-title">Sales Report</span>
      </div>

      <div className="page">
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="search-bar" style={{ flex: 1, margin: 0, minWidth: 200 }}>
            <span>🔍</span>
            <input
              placeholder="Search client, product, or group..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-color)', padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>From:</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', padding: '8px 0' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-color)', padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>To:</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', padding: '8px 0' }} />
          </div>
          {(fromDate || toDate) && (
            <button className="btn btn-ghost btn-sm" style={{ padding: 0, color: 'var(--primary-color)' }} onClick={() => { setFromDate(''); setToDate('') }}>Clear Date Filter</button>
          )}
        </div>

        {/* Table */}
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '10px 12px', width: 40 }}></th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Client</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Product Group</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Qty</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '32px 16px' }}><div className="spinner" style={{ display: 'inline-block' }} /></td></tr>
              ) : groupedData.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>No sales found for the selected criteria.</td></tr>
              ) : (
                groupedData.map(g => {
                  const key = `${g.clientName}|||${g.groupName}`
                  const isExpanded = expandedRows.has(key)
                  return (
                    <React.Fragment key={key}>
                      <tr onClick={() => toggleExpand(key)} style={{ borderBottom: '1px solid #f1f5f9', background: isExpanded ? '#f8fafc' : 'transparent', cursor: 'pointer' }}>
                        <td style={{ padding: '10px 12px', color: 'var(--primary-color)', textAlign: 'center' }}>
                          {isExpanded ? '▼' : '▶'}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{g.clientName}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{g.groupName}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{Number(g.totalQty).toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>₹{Number(g.totalAmount).toFixed(2)}</td>
                      </tr>
                      {isExpanded && g.products.map((p, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: '#fcfcfc' }}>
                          <td style={{ padding: '8px 12px' }}></td>
                          <td colSpan={2} style={{ padding: '8px 12px', color: '#64748b', paddingLeft: 32 }}>↳ {p.name}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{Number(p.totalQty).toFixed(2)} {p.unit}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>₹{Number(p.totalAmount).toFixed(2)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
