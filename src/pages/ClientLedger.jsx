import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ClientLedger() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [client, setClient] = useState(null)
  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [profile, setProfile] = useState(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedRefs, setSelectedRefs] = useState(new Set())
  const [activeTab, setActiveTab] = useState('ledger')
  const [purchases, setPurchases] = useState([])
  const [expandedProducts, setExpandedProducts] = useState(new Set())

  const groupedPurchases = useMemo(() => {
    const map = new Map();
    purchases.forEach(p => {
      const name = p.product_name || 'Manual Item';
      if (!map.has(name)) {
        map.set(name, { name, totalQty: 0, unit: p.unit || '', items: [], totalAmount: 0 });
      }
      const group = map.get(name);
      group.totalQty += Number(p.quantity) || 0;
      group.totalAmount += Number(p.amount) || 0;
      if (!group.unit && p.unit) group.unit = p.unit;
      group.items.push(p);
    });
    return Array.from(map.values()).sort((a,b) => b.totalAmount - a.totalAmount);
  }, [purchases]);

  const toggleExpand = (name) => {
    const next = new Set(expandedProducts);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedProducts(next);
  }

  // Payment Modal
  const [showModal, setShowModal] = useState(false)
  const [editPaymentId, setEditPaymentId] = useState(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('Cash')
  const [payRef, setPayRef] = useState('')
  const [payDesc, setPayDesc] = useState('Payment Received')

  async function loadData() {
    setLoading(true)
    try {
      const { data: pData } = await supabase.from('profile').select('*').single()
      if (pData) setProfile(pData)

      const { data: cData, error: cErr } = await supabase.from('clients').select('*').eq('id', id).single()
      if (cErr && cErr.code !== 'PGRST116') throw cErr;
      if (!cData) {
        setLoading(false)
        return
      }
      setClient(cData)

      // Fetch all estimates AND quotations for this client
      const { data: estData, error: estErr } = await supabase.from('estimates').select('*').eq('client_id', id)
      if (estErr) throw estErr;
      
      const { data: payData, error: payErr } = await supabase.from('payments').select('*').eq('client_id', id)
      if (payErr) throw payErr;

      const { data: purData, error: purErr } = await supabase.from('client_purchases').select('*').eq('client_id', id).order('created_at', { ascending: false })
      if (!purErr && purData) setPurchases(purData)

      const entries = []
      
      // Opening Balance
      if (Number(cData.opening_balance)) {
        entries.push({
          date: cData.created_at,
          description: 'Opening Balance',
          debit: cData.opening_balance > 0 ? cData.opening_balance : 0,
          credit: cData.opening_balance < 0 ? Math.abs(cData.opening_balance) : 0,
          type: 'OPENING'
        });
      }

      for (const e of (estData || [])) {
        if (e.type === 'QUOTATION') {
          entries.push({
            date: e.bill_date,
            description: `Quotation #${e.bill_number} (₹${Number(e.grand_total).toFixed(2)})`,
            debit: 0,
            credit: 0,
            type: 'QUOTE',
            ref: e.id
          });
        } else if (e.type === 'RETURN') {
          entries.push({
            date: e.bill_date,
            description: `Sales Return #${e.bill_number}`,
            debit: 0,
            credit: e.grand_total,
            type: 'RETURN',
            ref: e.id
          });
        } else {
          entries.push({
            date: e.bill_date,
            description: `Bill #${e.bill_number}`,
            debit: e.grand_total,
            credit: 0,
            type: 'BILL',
            ref: e.id
          });
        }
      }

      for (const p of (payData || [])) {
        if (Number(p.amount) < 0) {
          entries.push({
            date: p.payment_date,
            description: p.description,
            debit: Math.abs(Number(p.amount)),
            credit: 0,
            type: 'MANUAL_DEBIT',
            ref: p.id
          });
        } else {
          entries.push({
            date: p.payment_date,
            description: p.description + (p.payment_mode ? ` (${p.payment_mode})` : ''),
            debit: 0,
            credit: p.amount,
            type: 'PAYMENT',
            ref: p.id
          });
        }
      }
      
      // Sort chronologically
      entries.sort((a, b) => parseDate(a.date) - parseDate(b.date))

      // Calculate running balance
      let bal = 0
      const finalEntries = entries.map(e => {
        bal = bal + Number(e.debit) - Number(e.credit)
        return { ...e, balance: bal }
      })

      setLedger(finalEntries)
    } catch (e) {
      console.error("Load Data Error:", e)
      alert("Error loading data: " + (e.message || e.toString()))
    } finally {
      setLoading(false)
    }
  }

  function parseDate(dateStr) {
    if (!dateStr) return new Date(0)
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d
    const parts = String(dateStr).replace(/\//g, '-').split('-')
    if (parts.length === 3 && parts[2].length === 4) {
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`)
    }
    return new Date(0)
  }

  const filteredLedger = useMemo(() => {
    let result = []
    let ob = null
    const fd = fromDate ? new Date(fromDate) : null
    const td = toDate ? new Date(toDate) : null

    if (fd) {
      const prior = ledger.filter(l => parseDate(l.date) < fd)
      if (prior.length > 0) ob = prior[prior.length - 1].balance
      else ob = Number(client?.opening_balance || 0)
    }

    const currentRows = ledger.filter(l => {
      const d = parseDate(l.date)
      if (fd && d < fd) return false
      if (td && d > td) return false
      
      if (search.trim()) {
        const terms = search.toLowerCase().trim().split(/\s+/)
        const target = `${l.description || ''} ${l.date || ''}`.toLowerCase()
        if (!terms.every(t => target.includes(t))) return false
      }
      return true
    })

    if (fd && ob !== null) {
       result.push({
         date: fromDate,
         description: 'Opening Balance (Brought Forward)',
         debit: 0,
         credit: 0,
         balance: ob,
         type: 'OPENING'
       })
    }

    result = [...result, ...currentRows]
    return result
  }, [ledger, fromDate, toDate, search, client])

  useEffect(() => { loadData() }, [id])

  async function handleDeletePayment(paymentId) {
    if (!window.confirm('Are you sure you want to delete this payment record? This action cannot be undone.')) return
    try {
      const { error } = await supabase.from('payments').delete().eq('id', paymentId)
      if (error) throw error
      loadData()
    } catch (e) {
      alert("Failed to delete payment: " + e.message)
    }
  }

  async function handleDeleteSelected() {
    if (selectedRefs.size === 0) return
    if (!window.confirm(`Are you sure you want to delete ${selectedRefs.size} selected entries?\n\nWARNING: Deleting Bills from the ledger will permanently delete them from the entire system.`)) return
    
    const paymentIds = []
    const billIds = []
    
    for (const l of filteredLedger) {
      if (selectedRefs.has(l.ref)) {
        if (l.type === 'BILL' || l.type === 'QUOTE') {
          billIds.push(l.ref)
        } else if (l.type === 'PAYMENT' || l.type === 'MANUAL_DEBIT') {
          paymentIds.push(l.ref)
        }
      }
    }
    
    let hasError = false
    try {
      if (paymentIds.length > 0) {
        const { error } = await supabase.from('payments').delete().in('id', paymentIds)
        if (error) throw error
      }
      if (billIds.length > 0) {
        const { error } = await supabase.from('estimates').delete().in('id', billIds)
        if (error) throw error
      }
    } catch (e) {
      alert("Error deleting: " + e.message)
      hasError = true
    }
    
    if (!hasError) {
      setSelectedRefs(new Set())
      loadData()
    }
  }

  function handleSelectAll(e) {
    if (e.target.checked) {
      const allRefs = filteredLedger.filter(l => l.type !== 'OPENING').map(l => l.ref)
      setSelectedRefs(new Set([...selectedRefs, ...allRefs]))
    } else {
      const visibleRefs = new Set(filteredLedger.map(l => l.ref))
      const newSet = new Set([...selectedRefs].filter(ref => !visibleRefs.has(ref)))
      setSelectedRefs(newSet)
    }
  }

  async function handleAddPayment(e) {
    e.preventDefault()
    if (!payAmount) return
    const payload = {
      client_id: id,
      payment_date: payDate,
      amount: payAmount,
      payment_mode: payMode,
      reference_number: payRef,
      description: payDesc
    }
    
    let error;
    if (editPaymentId) {
      const { error: err } = await supabase.from('payments').update(payload).eq('id', editPaymentId)
      error = err;
    } else {
      const { error: err } = await supabase.from('payments').insert([payload])
      error = err;
    }

    if (!error) {
      setShowModal(false)
      setPayAmount('')
      setPayRef('')
      setPayDesc('Payment Received')
      setEditPaymentId(null)
      loadData()
    } else {
      alert(error.message)
    }
  }

  async function handleEditClick(paymentId) {
    const { data } = await supabase.from('payments').select('*').eq('id', paymentId).single()
    if (data) {
      setEditPaymentId(data.id)
      setPayDate(data.payment_date)
      setPayAmount(data.amount)
      setPayMode(data.payment_mode || 'Cash')
      setPayRef(data.reference_number || '')
      setPayDesc(data.description || '')
      setShowModal(true)
    }
  }

  async function generatePDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF()
    
    // ---- HEADER ----
    doc.setFontSize(22)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(140, 120, 90) // Professional Dark Beige
    doc.text('STATEMENT OF ACCOUNT', 14, 25)

    if (fromDate || toDate) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      const pF = fromDate ? new Date(fromDate).toLocaleDateString('en-GB') : 'Start'
      const pT = toDate ? new Date(toDate).toLocaleDateString('en-GB') : 'Today'
      doc.text(`Period: ${pF} to ${pT}`, 14, 31)
    }

    let yPos = 35

    // Divider
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.5)
    doc.line(14, yPos + 2, 196, yPos + 2)

    // ---- CLIENT & SUMMARY DETAILS ----
    yPos += 12
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('BILL TO:', 14, yPos)
    
    doc.setFont('helvetica', 'normal')
    doc.text(client?.name || '', 14, yPos + 6)
    if (client?.mobile) doc.text(`Mobile: ${client.mobile}`, 14, yPos + 12)

    doc.setFont('helvetica', 'bold')
    doc.text('STATEMENT DATE:', 196, yPos, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.text(new Date().toLocaleDateString('en-GB'), 196, yPos + 6, { align: 'right' })

    const finalBalance = filteredLedger.length > 0 ? filteredLedger[filteredLedger.length - 1].balance : 0
    doc.setFont('helvetica', 'bold')
    doc.text('AMOUNT DUE:', 196, yPos + 14, { align: 'right' })
    doc.setFontSize(12)
    doc.setTextColor(220, 38, 38) // Red if due
    if (finalBalance < 0) doc.setTextColor(16, 185, 129) // Green if credit
    if (finalBalance === 0) doc.setTextColor(0, 0, 0)
    
    doc.text(`Rs. ${Math.abs(finalBalance).toFixed(2)} ${finalBalance > 0 ? 'Dr' : (finalBalance < 0 ? 'Cr' : '')}`, 196, yPos + 20, { align: 'right' })

    doc.setTextColor(0, 0, 0) // reset

    // ---- TABLE ----
    const tableData = filteredLedger.map(l => {
       const dateStr = (() => {
          const d = new Date(l.date)
          if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB')
          const parts = String(l.date).replace(/\//g, '-').split('-')
          if (parts.length === 3 && parts[2].length === 4) {
            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`).toLocaleDateString('en-GB')
          }
          return String(l.date).replace(/-/g, '/')
        })()
       return [
         dateStr,
         String(l.description).replace(/₹/g, 'Rs. '),
         l.debit > 0 ? l.debit.toFixed(2) : '-',
         l.credit > 0 ? l.credit.toFixed(2) : '-',
         `${Math.abs(l.balance).toFixed(2)} ${l.balance > 0 ? 'Dr' : (l.balance < 0 ? 'Cr' : '')}`
       ]
    })

    autoTable(doc, {
      startY: yPos + 30,
      head: [['Date', 'Description', 'Debit (Material Delivered)', 'Credit (Payment Received)', 'Balance']],
      body: tableData,
      theme: 'grid',
      headStyles: { 
        fillColor: [215, 205, 185], // Elegant Beige
        textColor: 0, // Black text for contrast
        fontStyle: 'bold'
      },
      styles: {
        fontSize: 10,
        cellPadding: 5,
        lineColor: [220, 220, 220]
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' }
      }
    })

    return doc
  }

  async function handleDownloadPDF() {
    setExporting(true)
    try {
      const doc = await generatePDF()
      doc.save(`Ledger-${client?.name || 'Client'}.pdf`)
    } catch (e) {
      alert("Failed to generate PDF: " + e.message)
    } finally {
      setExporting(false)
    }
  }

  async function handleShareWhatsApp() {
    setExporting(true)
    try {
      const doc = await generatePDF()
      const blob = doc.output('blob')
      const file = new File([blob], `Ledger-${client?.name || 'Client'}.pdf`, { type: 'application/pdf' })

      const text = `Hello ${client?.name || ''}, please find your Statement of Account attached.`

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Statement of Account',
          text: text
        })
      } else {
        // Fallback for desktop/unsupported browsers
        doc.save(`Ledger-${client?.name || 'Client'}.pdf`)
        alert("Your PDF has been downloaded. We will now open WhatsApp where you can manually attach the file.")
        let phone = client?.mobile ? String(client.mobile).replace(/\D/g, '') : ''
        if (phone && phone.length === 10) phone = '91' + phone
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank')
      }
    } catch (e) {
      alert("Failed to share: " + e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app-container">
      <div className="header">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
        <h1>Statement of Account</h1>
        <div style={{ width: 60 }} />
      </div>

      <div className="page" style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>Loading...</div>
        ) : !client ? (
          <div style={{ textAlign: 'center', padding: 20 }}>Client not found.</div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{client.name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{client.mobile}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleDownloadPDF} disabled={exporting}>
                    📥 {exporting ? 'Wait...' : 'PDF'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={handleShareWhatsApp} disabled={exporting} style={{ background: '#25D366', color: 'white', border: 'none' }}>
                    💬 WhatsApp
                  </button>
                  <button className="primary-btn" style={{ padding: '6px 12px', margin: 0 }} onClick={() => {
                    setEditPaymentId(null)
                    setPayAmount('')
                    setPayDesc('Payment Received')
                    setPayDate(new Date().toISOString().split('T')[0])
                    setShowModal(true)
                  }}>
                    + Add Payment
                  </button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, borderBottom: '1px solid var(--border-light)' }}>
              <button 
                onClick={() => setActiveTab('ledger')}
                style={{ 
                  background: 'none', border: 'none', padding: '8px 16px', fontSize: 16, cursor: 'pointer',
                  borderBottom: activeTab === 'ledger' ? '2px solid var(--primary-color)' : '2px solid transparent',
                  color: activeTab === 'ledger' ? 'var(--primary-color)' : 'var(--text-muted)',
                  fontWeight: activeTab === 'ledger' ? 700 : 400
                }}>
                Financial Ledger
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                style={{ 
                  background: 'none', border: 'none', padding: '8px 16px', fontSize: 16, cursor: 'pointer',
                  borderBottom: activeTab === 'history' ? '2px solid var(--primary-color)' : '2px solid transparent',
                  color: activeTab === 'history' ? 'var(--primary-color)' : 'var(--text-muted)',
                  fontWeight: activeTab === 'history' ? 700 : 400
                }}>
                Item History
              </button>
            </div>

            {activeTab === 'ledger' ? (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                   <div className="search-bar" style={{ flex: 1, margin: 0, minWidth: 200 }}>
                  <span>🔍</span>
                  <input
                    placeholder="Search transactions..."
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
                 <button className="btn btn-ghost btn-sm" onClick={() => { setFromDate(''); setToDate('') }}>Clear Filter</button>
               )}
            </div>

            {selectedRefs.size > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fee2e2', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
                <span style={{ fontWeight: 600, color: '#991b1b' }}>{selectedRefs.size} entries selected</span>
                <button className="btn btn-danger btn-sm" style={{ margin: 0 }} onClick={handleDeleteSelected}>🗑️ Delete Selected</button>
              </div>
            )}

            <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: '800px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '12px', width: 40, textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={filteredLedger.filter(l => l.type !== 'OPENING').length > 0 && filteredLedger.filter(l => l.type !== 'OPENING').every(l => selectedRefs.has(l.ref))} 
                        onChange={handleSelectAll} 
                      />
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>Date</th>
                    <th style={{ padding: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>Description</th>
                    <th style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>Debit (Material Dispatched)</th>
                    <th style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>Credit (Payment Received)</th>
                    <th style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLedger.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: l.type === 'OPENING' ? '#fffbeb' : (selectedRefs.has(l.ref) ? '#f0f9ff' : (l.type === 'QUOTE' ? '#f8fafc' : 'transparent')) }}>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {l.type !== 'OPENING' && (
                          <input 
                            type="checkbox" 
                            checked={selectedRefs.has(l.ref)} 
                            onChange={() => {
                              const newSet = new Set(selectedRefs)
                              if (newSet.has(l.ref)) newSet.delete(l.ref)
                              else newSet.add(l.ref)
                              setSelectedRefs(newSet)
                            }} 
                          />
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {(() => {
                          const d = new Date(l.date)
                          if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB')
                          const parts = String(l.date).replace(/\//g, '-').split('-')
                          if (parts.length === 3 && parts[2].length === 4) {
                            return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`).toLocaleDateString('en-GB')
                          }
                          return String(l.date).replace(/-/g, '/')
                        })()}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: l.type === 'BILL' ? 600 : (l.type === 'QUOTE' ? 500 : 400), color: l.type === 'QUOTE' ? '#64748b' : '#000' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{l.description}</span>
                          {(l.type === 'PAYMENT' || l.type === 'MANUAL_DEBIT') && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button 
                                className="btn btn-ghost btn-sm" 
                                style={{ padding: '2px 6px', margin: 0, color: '#3b82f6' }} 
                                title="Edit"
                                onClick={() => handleEditClick(l.ref)}
                              >
                                ✏️
                              </button>
                              <button 
                                className="btn btn-ghost btn-sm" 
                                style={{ padding: '2px 6px', margin: 0, color: '#ef4444' }} 
                                title={l.type === 'MANUAL_DEBIT' ? 'Delete Record' : 'Delete Payment'}
                                onClick={() => handleDeletePayment(l.ref)}
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ef4444' }}>{l.debit > 0 ? l.debit.toFixed(2) : '-'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#10b981' }}>{l.credit > 0 ? l.credit.toFixed(2) : '-'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: l.type === 'QUOTE' ? 400 : 600, color: l.type === 'QUOTE' ? '#94a3b8' : '#000' }}>
                        {Math.abs(l.balance).toFixed(2)} {l.balance > 0 ? 'Dr' : (l.balance < 0 ? 'Cr' : '')}
                      </td>
                    </tr>
                  ))}
                  {filteredLedger.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20 }}>No transactions found.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
              </>
            ) : (
              <div className="table-container" style={{ overflowX: 'auto', background: 'var(--surface-color)', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Bill No.</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left' }}>Item</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Quantity</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Rate</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedPurchases.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
                          No items purchased yet.
                        </td>
                      </tr>
                    ) : (
                      groupedPurchases.map(g => (
                        <Fragment key={g.name}>
                          <tr onClick={() => toggleExpand(g.name)} style={{ borderBottom: '1px solid #f1f5f9', background: expandedProducts.has(g.name) ? '#f8fafc' : 'transparent', cursor: 'pointer' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--primary-color)', width: '40px', textAlign: 'center' }}>
                              {expandedProducts.has(g.name) ? '▼' : '▶'}
                            </td>
                            <td style={{ padding: '10px 12px' }}></td>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{g.name}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{Number(g.totalQty).toFixed(2)} {g.unit}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}></td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{Number(g.totalAmount).toFixed(2)}</td>
                          </tr>
                          {expandedProducts.has(g.name) && g.items.map(p => (
                            <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: '#fcfcfc' }}>
                              <td style={{ padding: '8px 12px', color: '#64748b', textAlign: 'center' }}>{new Date(p.bill_date || p.created_at).toLocaleDateString('en-GB')}</td>
                              <td style={{ padding: '8px 12px', color: '#64748b' }}>{p.bill_number}</td>
                              <td style={{ padding: '8px 12px' }}></td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{Number(p.quantity)} {p.unit}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{Number(p.rate).toFixed(2)}</td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b' }}>{Number(p.amount).toFixed(2)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {showModal && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <h3 style={{ marginTop: 0 }}>{editPaymentId ? 'Edit Payment' : 'Add Payment'}</h3>
                  <form onSubmit={handleAddPayment} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Date</label>
                      <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} required style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Amount (₹)</label>
                      <input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} required style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Payment Mode</label>
                      <select value={payMode} onChange={e => setPayMode(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }}>
                        <option>Cash</option>
                        <option>UPI / GPay</option>
                        <option>Bank Transfer / NEFT</option>
                        <option>Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>Description</label>
                      <input type="text" value={payDesc} onChange={e => setPayDesc(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: 4 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button type="submit" className="primary-btn" style={{ flex: 1, margin: 0 }}>Save Payment</button>
                      <button type="button" className="home-btn" style={{ flex: 1, margin: 0, background: '#f1f5f9' }} onClick={() => setShowModal(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
