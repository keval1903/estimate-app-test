import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast.jsx'

export default function EstimateView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { showToast, ToastEl } = useToast()
  const [estimate, setEstimate] = useState(null)
  const [items, setItems] = useState([])
  const [clientBalance, setClientBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState('')
  const [paperSize, setPaperSize] = useState('a5')
  const [layoutMode, setLayoutMode] = useState('full')
  const [converting, setConverting] = useState(false)
  const [isExportingSingleImage, setIsExportingSingleImage] = useState(false)
  const previewRef = useRef()

  useEffect(() => {
    async function load() {
      const { data: est } = await supabase
        .from('estimates').select('*').eq('id', id).single()
      const { data: eitems } = await supabase
        .from('estimate_items').select('*')
        .eq('estimate_id', id).order('serial_number')
      
      setEstimate(est)
      setItems(eitems || [])

      // Fetch ledger balance if this is a final estimate linked to a client
      if (est?.type === 'ESTIMATE' && est?.client_id) {
        const { data: estData } = await supabase.from('estimates').select('grand_total').eq('client_id', est.client_id).eq('type', 'ESTIMATE')
        const { data: payData } = await supabase.from('payments').select('amount').eq('client_id', est.client_id)
        const { data: cData } = await supabase.from('clients').select('opening_balance').eq('id', est.client_id).single()
        
        const estTotal = (estData || []).reduce((sum, e) => sum + Number(e.grand_total || 0), 0)
        const payTotal = (payData || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
        setClientBalance(Number(cData?.opening_balance || 0) + estTotal - payTotal)
      }

      setLoading(false)
    }
    load()
  }, [id])

  function getFilename(ext) {
    const site = (estimate?.site_name || 'SITE').replace(/\s+/g, '-')
    return `Estimate-${estimate?.bill_number}-${site}.${ext}`
  }

  function getSummaryText() {
    const isQuote = estimate?.type === 'QUOTATION'
    const client = estimate?.client_name || estimate?.transport || ''
    let text = `${isQuote ? 'Quotation' : 'Estimate'} No. ${estimate?.bill_number}\nDate: ${estimate?.bill_date}\nSite: ${estimate?.site_name}`
    if (client) text += `\nClient: ${client}`
    if (estimate?.client_mobile) text += `\nM.: ${estimate.client_mobile}`
    if (estimate?.prepared_by) text += `\nPrep. By: ${estimate.prepared_by}`
    text += `\nGrand Total: ₹${Number(estimate?.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    return text
  }

  async function generateCanvas(el, scale = 2, targetWidth = '680px') {
    const { default: html2canvas } = await import('html2canvas')

    // Force exact width so canvas aspect ratio perfectly matches physical paper sizes
    const originalWidth = el.style.width
    const originalMaxWidth = el.style.maxWidth
    el.style.width = targetWidth
    el.style.maxWidth = 'none'

    const oldScroll = window.scrollY
    window.scrollTo(0, 0)
    // Force browser to recalculate layout synchronously without losing user gesture
    void el.offsetHeight

    const canvas = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: '#fff',
      scrollX: 0,
      scrollY: 0
    })

    // Restore
    el.style.width = originalWidth
    el.style.maxWidth = originalMaxWidth
    window.scrollTo(0, oldScroll)

    return canvas
  }

  function handlePrint() {
    window.print()
  }

  async function handleSavePDF() {
    setExporting('pdf')
    try {
      const { default: jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: paperSize })
      const pdfW = pdf.internal.pageSize.getWidth()
      
      const pagesEls = document.querySelectorAll('.estimate-page')
      const targetWidth = paperSize === 'a5' ? '529px' : '763px'
      
      for (let i = 0; i < pagesEls.length; i++) {
        if (i > 0) pdf.addPage()
        const canvas = await generateCanvas(pagesEls[i], 2, targetWidth)
        const imgData = canvas.toDataURL('image/png')
        
        const margin = 8; // 8mm margin on all sides
        const drawWidth = pdfW - (margin * 2);
        const drawHeight = (canvas.height * drawWidth) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', margin, margin, drawWidth, drawHeight)
      }
      
      pdf.save(getFilename('pdf'))
      showToast('PDF saved ✓')
    } catch (e) {
      showToast('PDF failed: ' + e.message, 'error')
    }
    setExporting('')
  }

  async function handleSaveImage() {
    setExporting('img')
    setIsExportingSingleImage(true)
    // Wait for React to render the unpaginated view
    await new Promise(r => setTimeout(r, 150))
    try {
      const canvas = await generateCanvas(previewRef.current, 3)
      const link = document.createElement('a')
      link.download = getFilename('png')
      link.href = canvas.toDataURL('image/png')
      link.click()
      showToast('Image saved ✓')
    } catch (e) {
      showToast('Image failed: ' + e.message, 'error')
    } finally {
      setIsExportingSingleImage(false)
      setExporting('')
    }
  }

  async function handleShare() {
    const text = getSummaryText()
    if (navigator.share) {
      try {
        await navigator.share({ title: `Estimate #${estimate.bill_number}`, text })
      } catch { }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        showToast('Summary copied!')
      } catch {
        showToast('Copy failed', 'error')
      }
    }
  }

  async function handleWhatsApp() {
    const text = getSummaryText()
    setExporting('whatsapp')
    setIsExportingSingleImage(true)
    // Wait for React to render the unpaginated view
    await new Promise(r => setTimeout(r, 150))

    try {
      // Try native share with image first (mobile/HTTPS)
      if (navigator.share && navigator.canShare) {
        try {
          const canvas = await generateCanvas(previewRef.current, 3)
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
          const files = [new File([blob], getFilename('png'), { type: 'image/png' })]

          if (navigator.canShare({ files })) {
            try {
              await navigator.clipboard.writeText(text)
              showToast('Caption copied! Paste it in WhatsApp')
            } catch (e) { }

            await navigator.share({ files, title: `Estimate #${estimate.bill_number}`, text })
            return
          }
        } catch { }
      }

      // Fallback for HTTP (local network) where navigator.share is blocked by the browser
      try {
        const canvas = await generateCanvas(previewRef.current, 3)
        const link = document.createElement('a')
        link.download = getFilename('png')
        link.href = canvas.toDataURL('image/png')
        link.click()
        showToast('Image saved! Please attach it in WhatsApp.', 'success', 4000)
      } catch (e) { }

      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    } finally {
      setIsExportingSingleImage(false)
      setExporting('')
    }
  }

  async function handleConvertToEstimate() {
    if (!window.confirm('Convert this Quotation to an Estimate? Stock will be deducted.')) return
    setConverting(true)
    try {
      const { data: allProducts } = await supabase.from('products').select('*')
      const prodMap = {}
      for (const p of (allProducts || [])) prodMap[p.id] = p

      // 1. Check stock sufficiency for all items first
      for (const it of items) {
        if (it.product_id && prodMap[it.product_id] && prodMap[it.product_id].has_stock) {
          const p = prodMap[it.product_id]
          const reqQty = (it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET') ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
          const avail = Number(p.stock || 0)
          if (reqQty > avail) {
            showToast(`Cannot convert! Insufficient stock for ${p.product_name}. Required: ${reqQty} ${p.unit}, Available: ${avail} ${p.unit}.`, 'error')
            setConverting(false)
            return
          }
        }
      }

      // 2. Perform stock deduction
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
              estimate_id: id
            })
          }
        }
      }

      // 3. Ensure client_id is set (in case this was an old quotation without one)
      let finalClientId = estimate?.client_id || null;
      if (!finalClientId) {
        const cName = (estimate?.client_name || estimate?.transport || '').trim().toUpperCase();
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
      }).eq('id', id)

      if (error) throw error

      showToast('Converted to Estimate & Stock Deducted ✓')
      
      // Reload the page to ensure all balances and references are fetched correctly
      setTimeout(() => {
        window.location.reload()
      }, 500)
      
    } catch (e) {
      showToast('Conversion failed: ' + e.message, 'error')
    } finally {
      setConverting(false)
    }
  }

  // Smart Pagination Logic
  const A5_ROWS = 24;
  const A4_ROWS = 40;
  const SQUEEZE_LIMIT = 2;
  
  const pages = useMemo(() => {
    if (!items || items.length === 0) return [{ items: [], carried: null, brought: null, isLast: true }];
    
    const maxRows = isExportingSingleImage ? Infinity : (paperSize === 'a5' ? A5_ROWS : A4_ROWS);
    
    const result = [];
    let currentNos = 0;
    let currentQty = 0;
    let currentAmt = 0;
    
    for (let i = 0; i < items.length;) {
      const isFirst = result.length === 0;
      let availableRowsForItems = maxRows;
      
      if (!isFirst) availableRowsForItems -= 1; // Room for Brought Forward
      
      const remainingItems = items.length - i;
      let isLast = false;
      
      const extraRows = (estimate?.type === 'ESTIMATE' && estimate?.client_id) ? 4 : 2;
      
      // If remaining items + extra totals rows fits within the squeeze limit
      if (remainingItems + extraRows <= availableRowsForItems + (isExportingSingleImage ? 0 : SQUEEZE_LIMIT)) {
        isLast = true;
        availableRowsForItems = remainingItems;
      } else {
        // Doesn't fit, we need room for Carried Forward
        availableRowsForItems -= 1;
      }
      
      const chunk = items.slice(i, i + availableRowsForItems);
      
      const brought = isFirst ? null : {
        nos: currentNos,
        qty: currentQty,
        amt: currentAmt
      };

      chunk.forEach(it => {
        const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
        currentNos += isPieceBased ? (Number(it.nos) || 0) : (Number(it.quantity) || 0);
        currentQty += Number(it.quantity) || 0;
        currentAmt += Number(it.amount) || 0;
      });

      const carried = isLast ? null : {
        nos: currentNos,
        qty: currentQty,
        amt: currentAmt
      };

      result.push({ items: chunk, carried, brought, isLast });
      i += availableRowsForItems;
    }
    
    return result;
  }, [items, paperSize, isExportingSingleImage]);

  if (loading) return <div className="app-container"><div className="spinner" /></div>
  if (!estimate) return (
    <div className="app-container">
      <div className="page"><p>Estimate not found.</p></div>
    </div>
  )

  const totalNos = items.reduce((sum, it) => {
    const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
    return sum + (isPieceBased ? (Number(it.nos) || 0) : (Number(it.quantity) || 0));
  }, 0);
  const totalQty = Number(estimate.total_quantity)
  const grandTotal = Number(estimate.grand_total)

  return (
    <div className="app-container">
      {/* Nav */}
      <div className="top-nav no-print">
        <button className="nav-back" onClick={() => navigate(-1)}>←</button>
        <span className="nav-title">{estimate.type === 'QUOTATION' ? 'Quotation' : 'Estimate'} #{estimate.bill_number}</span>
      </div>

      {/* Action buttons */}
      <div className="preview-actions no-print">
        <div style={{ display: 'inline-flex', gap: 8, marginRight: 'auto' }}>
          <select className="btn btn-secondary btn-sm" value={paperSize} onChange={e => setPaperSize(e.target.value)}>
            <option value="a4">Size: A4</option>
            <option value="a5">Size: A5</option>
          </select>
          <select className="btn btn-secondary btn-sm" value={layoutMode} onChange={e => setLayoutMode(e.target.value)}>
            <option value="full">Layout: Full</option>
            <option value="compact">Layout: Compact</option>
          </select>
        </div>

        {estimate.type === 'QUOTATION' && (
          <button className="btn btn-warning btn-sm"
            onClick={handleConvertToEstimate} disabled={converting}>
            {converting ? 'Converting...' : '⚡ Convert to Estimate'}
          </button>
        )}
        <button className="btn btn-secondary btn-sm"
          onClick={() => navigate(`/estimate/edit/${id}`)}>✏️ Edit</button>
        <button className="btn btn-primary btn-sm"
          onClick={handlePrint}>🖨 Print</button>
        <button className="btn btn-secondary btn-sm"
          onClick={handleSavePDF} disabled={exporting === 'pdf'}>
          {exporting === 'pdf' ? '...' : '📄 PDF'}
        </button>
        <button className="btn btn-secondary btn-sm"
          onClick={handleSaveImage} disabled={exporting === 'img' || isExportingSingleImage}>
          {exporting === 'img' ? '...' : '🖼 Image'}
        </button>
        <button className="btn btn-secondary btn-sm"
          onClick={handleShare}>📤 Share</button>
        <button className="btn btn-whatsapp btn-sm"
          onClick={handleWhatsApp} disabled={exporting === 'whatsapp' || isExportingSingleImage}>
          {exporting === 'whatsapp' ? '...' : '💬 WhatsApp'}
        </button>
      </div>

      {/* ── ESTIMATE PREVIEW ── */}
      <div id="print-area" style={{ padding: '0 8px 100px', background: 'var(--bg)' }}>
        <div id="estimate-preview" ref={previewRef} style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {pages.map((page, pageIndex) => (
            <div key={pageIndex} className="estimate-page" style={{ pageBreakAfter: page.isLast ? 'auto' : 'always', position: 'relative' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#000', background: '#fff' }}>
                <colgroup>
                  <col style={{ width: 42 }} />     {/* Sr No */}
                  <col style={{ width: 'auto' }} /> {/* Description */}
                  <col style={{ width: 42 }} />     {/* Nos. */}
                  <col style={{ width: 68 }} />     {/* Quantity */}
                  <col style={{ width: 72 }} />     {/* Rate */}
                  <col style={{ width: 94 }} />     {/* Amount */}
                </colgroup>
                <tbody>
                  {/* Title row */}
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: 2, padding: '6px 0', borderBottom: '1px solid #000' }}>
                      {estimate.type === 'QUOTATION' ? 'Q U O T A T I O N' : 'E S T I M A T E'}
                      {pages.length > 1 && <span style={{ fontSize: 10, fontWeight: 400, position: 'absolute', right: 8, top: 8 }}>(Page {pageIndex + 1}/{pages.length})</span>}
                    </td>
                  </tr>

                  {/* Meta details */}
                  <tr>
                    {/* Left side: Site, Client & Mobile */}
                    <td colSpan={3} style={{ padding: '6px 10px', verticalAlign: 'top', borderBottom: '1px solid #000', borderRight: '1px solid #000' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {[
                            ['Site', estimate.site_name],
                            ['Client', estimate.client_name || estimate.transport || ''],
                            ['Mobile', estimate.client_mobile || ''],
                          ].map(([label, val]) => (
                            <tr key={label}>
                              <td style={{ width: 52, fontWeight: 600, paddingBottom: 2 }}>{label}</td>
                              <td style={{ width: 10, paddingBottom: 2 }}>:</td>
                              <td style={{ fontWeight: label === 'Site' ? 700 : 400, paddingBottom: 2 }}>{val}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                    {/* Right side: Date, No. & Prepared By */}
                    <td colSpan={3} style={{ padding: '6px 10px', verticalAlign: 'top', borderBottom: '1px solid #000' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {[
                            ['Date', estimate.bill_date],
                            ['No.', estimate.bill_number],
                            ['Prep. By', estimate.prepared_by || ''],
                          ].map(([label, val]) => (
                            <tr key={label}>
                              <td style={{ width: 68, fontWeight: 600, paddingBottom: 2 }}>{label}</td>
                              <td style={{ width: 10, paddingBottom: 2 }}>:</td>
                              <td style={{ fontWeight: 400, paddingBottom: 2 }}>{val}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>

                  {/* Table header */}
                  <tr style={{ background: '#f0f0f0' }}>
                    {['Sr No', 'Description of Goods', 'Nos.', 'Quantity', 'Rate', 'Amount'].map((h, i) => (
                      <td key={h} style={{
                        border: '1px solid #000', padding: '6px 4px', fontWeight: 700,
                        textAlign: i === 1 ? 'left' : 'center',
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                        width: i === 0 ? 42 : i === 1 ? 'auto' : i === 2 ? 42 : i === 3 ? 68 : i === 4 ? 72 : 94
                      }}>{h}</td>
                    ))}
                  </tr>

                  {/* Brought Forward Row */}
                  {page.brought && (
                    <tr style={{ background: '#fcfcfc', fontStyle: 'italic' }}>
                      <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>Brought Forward</td>
                      <td style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'center', fontSize: 12 }}>
                        {page.brought.nos % 1 === 0 ? page.brought.nos : page.brought.nos.toFixed(2)}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'center', fontSize: 12 }}>
                        {page.brought.qty % 1 === 0 ? page.brought.qty : page.brought.qty.toFixed(2)}
                      </td>
                      <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>
                        {page.brought.amt.toFixed(2)}
                      </td>
                    </tr>
                  )}

                  {/* Items */}
                  {page.items.map(it => (
                    <tr key={it.id}>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'center', fontSize: 12 }}>{it.serial_number}</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>
                        {it.product_name_snapshot}{it.remark ? ` - ${it.remark}` : ''}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'center', fontSize: 12 }}>
                        {(() => {
                          const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
                          const val = isPieceBased ? it.nos : it.quantity;
                          return val % 1 === 0 ? val : Number(val).toFixed(2);
                        })()}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'center', fontSize: 12 }}>
                        {it.quantity} {it.unit_snapshot}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'right', fontSize: 12 }}>
                        {Number(it.rate).toFixed(2)}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'right', fontSize: 12 }}>
                        {Number(it.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}

                  {/* Empty padding rows to perfectly align bottom */}
                  {page.isLast && Array.from({ 
                    length: isExportingSingleImage ? 0 : (layoutMode === 'compact' ? 2 : 
                      Math.max(0, (paperSize === 'a5' ? A5_ROWS : A4_ROWS) - page.items.length - (page.brought ? 1 : 0) - (estimate?.type === 'ESTIMATE' && estimate?.client_id ? 4 : 2)))
                  }).map((_, i) => (
                    <tr key={`empty-${i}`}>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                    </tr>
                  ))}

                  {/* Carried Forward Row */}
                  {page.carried && (
                    <tr style={{ background: '#fcfcfc', fontStyle: 'italic' }}>
                      <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>Carried Forward</td>
                      <td style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'center', fontSize: 12 }}>
                        {page.carried.nos % 1 === 0 ? page.carried.nos : page.carried.nos.toFixed(2)}
                      </td>
                      <td style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'center', fontSize: 12 }}>
                        {page.carried.qty % 1 === 0 ? page.carried.qty : page.carried.qty.toFixed(2)}
                      </td>
                      <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>
                        {page.carried.amt.toFixed(2)}
                      </td>
                    </tr>
                  )}

                  {/* Totals row (only on last page) */}
                  {page.isLast && (
                    <>
                      <tr style={{ background: '#f9f9f9', fontWeight: 700 }}>
                        <td colSpan={2} style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: 13 }}>Total</td>
                        <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                          {totalNos % 1 === 0 ? totalNos : totalNos.toFixed(2)}
                        </td>
                        <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                          {totalQty % 1 === 0 ? totalQty : totalQty.toFixed(2)}
                        </td>
                        <td style={{ border: '1px solid #000', padding: '6px 4px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }}>
                          {estimate?.type === 'ESTIMATE' && estimate?.client_id ? 'Bill Amt' : 'Gr.Total'}
                        </td>
                        <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {grandTotal.toFixed(2)}
                        </td>
                      </tr>
                      {estimate?.type === 'ESTIMATE' && estimate?.client_id && (
                        <>
                          <tr>
                            <td colSpan={4} style={{ border: '1px solid #000', padding: '4px 8px', borderRight: 'none' }}></td>
                            <td style={{ border: '1px solid #000', borderLeft: 'none', padding: '4px 4px', textAlign: 'right', fontSize: 13, fontStyle: 'italic' }}>Prev. Bal.</td>
                            <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 13, fontStyle: 'italic' }}>
                              {(clientBalance - grandTotal).toFixed(2)}
                            </td>
                          </tr>
                          <tr style={{ background: '#f1f5f9' }}>
                            <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 8px', borderRight: 'none', fontWeight: 600, fontSize: 13 }}>Estimate #{estimate.bill_number}</td>
                            <td style={{ border: '1px solid #000', borderLeft: 'none', padding: '6px 4px', textAlign: 'right', fontSize: 14, fontWeight: 700 }}>Total Due</td>
                            <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {clientBalance.toFixed(2)}
                            </td>
                          </tr>
                        </>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @page {
          size: ${paperSize === 'a5' ? 'A5' : 'A4'} portrait;
          margin: 0;
        }
        @media print {
          .no-print, .toast { display: none !important; }
          html, body, #root, .app-container { 
            height: auto !important; 
            min-height: auto !important; 
            margin: 0 !important; 
            padding: 0 !important; 
            overflow: visible !important;
          }
          #print-area {
            padding: 0 !important;
            background: white !important;
            margin: 0 !important;
            box-sizing: border-box !important;
          }
          #estimate-preview {
            max-width: none !important;
            padding: 4mm 4mm 15mm 4mm !important;
          }
          #estimate-preview table {
            width: 100% !important;
            table-layout: fixed !important;
          }
          #estimate-preview td {
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
          }
        }
      `}</style>

      {ToastEl}
    </div>
  )
}
