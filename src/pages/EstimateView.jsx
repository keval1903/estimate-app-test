import { useEffect, useState, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast.jsx'

export default function EstimateView() {
  const { role } = useAuth()
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
  const [isChallanMode, setIsChallanMode] = useState(false)
  const [scale, setScale] = useState(1)
  const [previewHeight, setPreviewHeight] = useState(0)
  const previewRef = useRef()
  const containerRef = useRef()

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
        const { data: estData } = await supabase.from('estimates').select('grand_total, type').eq('client_id', est.client_id).in('type', ['ESTIMATE', 'DELETED_ESTIMATE', 'RETURN', 'DELETED_RETURN'])
        const { data: payData } = await supabase.from('payments').select('amount').eq('client_id', est.client_id)
        const { data: cData } = await supabase.from('clients').select('opening_balance').eq('id', est.client_id).single()

        const estTotal = (estData || []).filter(e => e.type === 'ESTIMATE' || e.type === 'DELETED_ESTIMATE').reduce((sum, e) => sum + Number(e.grand_total || 0), 0)
        const returnTotal = (estData || []).filter(e => e.type === 'RETURN' || e.type === 'DELETED_RETURN').reduce((sum, e) => sum + Number(e.grand_total || 0), 0)
        const payTotal = (payData || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
        setClientBalance(Number(cData?.opening_balance || 0) + estTotal - returnTotal - payTotal)
      }

      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    function updateScale() {
      if (!containerRef.current) return
      const containerWidth = containerRef.current.clientWidth
      const targetWidth = paperSize === 'a5' ? 529 : 763
      if (containerWidth < targetWidth) {
        setScale(containerWidth / targetWidth)
      } else {
        setScale(1)
      }
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [paperSize, loading])

  useEffect(() => {
    if (!previewRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setPreviewHeight(entry.contentRect.height)
      }
    })
    observer.observe(previewRef.current)
    return () => observer.disconnect()
  }, [loading])

  function fmtMoney(val) {
    return Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function getFilename(ext) {
    const rawSite = estimate?.site_name || 'SITE'
    const cleanSite = rawSite.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'SITE'
    return `Estimate-${estimate?.bill_number || '0'}-${cleanSite}.${ext}`
  }

  function getSummaryText() {
    const isQuote = estimate?.type === 'QUOTATION'
    const client = estimate?.client_name || estimate?.transport || ''
    let text = `${isQuote ? 'Quotation' : estimate?.type === 'RETURN' ? 'Sales Return' : 'Estimate'} No. ${estimate?.bill_number}\nDate: ${estimate?.bill_date}\nSite: ${estimate?.site_name}`
    if (client) text += `\nClient: ${client}`
    if (estimate?.client_mobile) text += `\nM.: ${estimate.client_mobile}`
    if (estimate?.prepared_by) text += `\nPrep. By: ${estimate.prepared_by}`
    text += `\nGrand Total: ₹${Number(estimate?.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    return text
  }

  async function generateCanvas(el, scale = 2, targetWidth = '680px', addPadding = false) {
    const { default: html2canvas } = await import('html2canvas')
    const targetEl = (addPadding && el.querySelector('table')) || el

    // Force exact width so canvas aspect ratio perfectly matches physical paper sizes
    const originalWidth = targetEl.style.width
    const originalMaxWidth = targetEl.style.maxWidth
    targetEl.style.width = targetWidth
    targetEl.style.maxWidth = 'none'

    const oldScroll = window.scrollY
    window.scrollTo(0, 0)
    // Force browser to recalculate layout synchronously without losing user gesture
    void targetEl.offsetHeight

    const rawCanvas = await html2canvas(targetEl, {
      scale,
      useCORS: true,
      backgroundColor: '#fff',
      scrollX: 0,
      scrollY: 0
    })

    // Restore
    targetEl.style.width = originalWidth
    targetEl.style.maxWidth = originalMaxWidth
    window.scrollTo(0, oldScroll)

    if (!addPadding) return rawCanvas;

    // Add clean 16px white margin padding around all 4 sides of the table (for Image / WhatsApp export)
    const padding = 16 * scale
    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = rawCanvas.width + (padding * 2)
    finalCanvas.height = rawCanvas.height + (padding * 2)
    const ctx = finalCanvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height)
    ctx.drawImage(rawCanvas, padding, padding)

    return finalCanvas
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
      const pdfH = pdf.internal.pageSize.getHeight()

      const pagesEls = document.querySelectorAll('.estimate-page')
      const targetWidth = paperSize === 'a5' ? '529px' : '763px'

      const margin = paperSize === 'a5' ? 4 : 6
      const drawW = pdfW - (margin * 2)
      const drawH = pdfH - (margin * 2)

      for (let i = 0; i < pagesEls.length; i++) {
        if (i > 0) pdf.addPage()
        const canvas = await generateCanvas(pagesEls[i], 2, targetWidth, false)
        const imgData = canvas.toDataURL('image/jpeg', 0.95)
        pdf.addImage(imgData, 'JPEG', margin, margin, drawW, drawH)
      }

      pdf.save(getFilename('pdf'))
      showToast('PDF saved ✓')
    } catch (e) {
      showToast('PDF failed: ' + e.message, 'error')
    }
    setExporting('')
  }

  async function handleSaveImage() {
    flushSync(() => {
      setExporting('img')
      setIsExportingSingleImage(true)
    })
    try {
      const targetWidth = paperSize === 'a5' ? '529px' : '763px'
      const canvas = await generateCanvas(previewRef.current, 3, targetWidth, true)
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
    let phone = estimate?.client_mobile ? String(estimate.client_mobile).replace(/\D/g, '') : ''
    if (phone && phone.length === 10) phone = '91' + phone
    const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    let canShareFiles = false
    if (navigator.share && navigator.canShare) {
      try {
        canShareFiles = navigator.canShare({ files: [new File([''], 'test.png', { type: 'image/png' })] })
      } catch (e) {}
    }

    let fallbackWindow = null;
    if (!canShareFiles) {
      fallbackWindow = window.open(waUrl, '_blank');
      if (!fallbackWindow) {
        showToast('Please allow popups to open WhatsApp', 'error')
      }
    }

    flushSync(() => {
      setExporting('whatsapp')
      setIsExportingSingleImage(true)
    })

    try {
      const scale = isMobile ? 1.5 : 2
      const targetWidth = paperSize === 'a5' ? '529px' : '763px'
      const canvas = await generateCanvas(previewRef.current, scale, targetWidth, true)
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
      const file = new File([blob], getFilename('png'), { type: 'image/png' })

      if (canShareFiles) {
        try {
          if (navigator.canShare && !navigator.canShare({ files: [file] })) {
            throw new Error("File sharing not supported on this device.")
          }

          await navigator.share({ files: [file], title: `Estimate #${estimate.bill_number}`, text })
        } catch (error) {
          if (error.name !== 'AbortError') {
            showToast('Native share failed: ' + error.message, 'error')
          }
        }
      } else {
        // Desktop Fallback: Download page image(s) and open WhatsApp Web to client chat
        try {
          const link = document.createElement('a')
          link.download = file.name
          link.href = URL.createObjectURL(file)
          link.click()
          setTimeout(() => URL.revokeObjectURL(link.href), 1000)
          showToast('Image downloaded! Opening WhatsApp...', 'success', 5000)
        } catch (e) {
          showToast('Failed to save image', 'error')
        }
      }
    } finally {
      setIsExportingSingleImage(false)
      setExporting('')
    }
  }

  async function handleRevertToQuotation() {
    if (!window.confirm('Revert this Estimate to a Quotation? Stock will be added back and ledger entries will be removed.')) return
    setConverting(true)
    try {
      const { data: allProducts } = await supabase.from('products').select('*')
      const prodMap = {}
      for (const p of (allProducts || [])) prodMap[p.id] = p

      // 1. Perform stock addition (Revert deduction)
      for (const it of items) {
        if (it.product_id && prodMap[it.product_id] && prodMap[it.product_id].has_stock) {
          const qty = (it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET') ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
          if (qty > 0) {
            const p = prodMap[it.product_id]
            const newStock = Number(p.stock) + qty
            await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
            await supabase.from('stock_history').insert({
              product_id: p.id,
              change_type: 'REVERT_TO_QUOTATION',
              quantity_changed: qty, // positive to add stock back
              estimate_id: id,
              bill_number: estimate?.bill_number?.toString(),
              site_name: estimate?.site_name
            })
          }
        }
      }

      // 2. Remove Partywise Stock History (Ledger entries)
      await supabase.from('client_purchases').delete().eq('bill_number', estimate.bill_number);

      // 3. Update the estimate record type
      const { error } = await supabase.from('estimates').update({
        type: 'QUOTATION',
        updated_at: new Date().toISOString()
      }).eq('id', id)

      if (error) throw error

      showToast('Reverted to Quotation & Stock Added Back ✓')

      setTimeout(() => {
        window.location.reload()
      }, 500)

    } catch (e) {
      showToast('Revert failed: ' + e.message, 'error')
    } finally {
      setConverting(false)
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
              estimate_id: id,
              bill_number: estimate?.bill_number?.toString(),
              site_name: estimate?.site_name
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

      // 4. Record Partywise Stock History
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
            bill_number: estimate.bill_number,
            bill_date: estimate.bill_date
          };
        }).filter(r => r.quantity > 0 || r.amount > 0);

        if (purchaseRecords.length > 0) {
          await supabase.from('client_purchases').delete().eq('bill_number', estimate.bill_number);
          await supabase.from('client_purchases').insert(purchaseRecords);
        }
      }

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
  const A5_ROWS = 23;
  const A4_ROWS = 38;
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

      let extraRows = (estimate?.type === 'ESTIMATE' && estimate?.client_id) ? 4 : 2;
      if (Number(estimate?.gst_percent) > 0) {
        extraRows += 2;
      }

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

      let emptyRowsCount = 0;
      if (isLast) {
        const standardMaxRows = paperSize === 'a5' ? A5_ROWS : A4_ROWS;
        const occupied = chunk.length + (!isFirst ? 1 : 0) + extraRows;
        if (occupied < standardMaxRows) {
         // const maxEmpty = paperSize === 'a5' ? 12 : 20;
         // emptyRowsCount = Math.min(emptyRowsCount, maxEmpty);
          emptyRowsCount = standardMaxRows - occupied;
        }
      }

      result.push({ items: chunk, carried, brought, isLast, emptyRowsCount });
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
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">{estimate.type === 'QUOTATION' ? 'Quotation' : estimate.type === 'RETURN' ? 'Sales Return' : 'Estimate'} #{estimate.bill_number}</span>
      </div>

      {/* Action buttons */}
      <div className="preview-actions no-print">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginRight: 'auto' }}>
          <select className="btn btn-secondary btn-sm" value={paperSize} onChange={e => setPaperSize(e.target.value)}>
            <option value="a4">Size: A4</option>
            <option value="a5">Size: A5</option>
          </select>
          <select className="btn btn-secondary btn-sm" value={layoutMode} onChange={e => setLayoutMode(e.target.value)}>
            <option value="full">Layout: Full</option>
            <option value="compact">Layout: Compact</option>
          </select>
          <select className="btn btn-secondary btn-sm" value={isChallanMode ? 'challan' : 'standard'} onChange={e => setIsChallanMode(e.target.value === 'challan')}>
            <option value="standard">Mode: Standard</option>
            <option value="challan">Mode: Challan</option>
          </select>
        </div>

        {estimate.type === 'QUOTATION' && (
          <button className="btn btn-warning btn-sm"
            onClick={handleConvertToEstimate} disabled={converting}>
            {converting ? 'Converting...' : '⚡ Convert to Estimate'}
          </button>
        )}
        {estimate.type === 'ESTIMATE' && role === 'ADMIN' && (
          <button className="btn btn-warning btn-sm" style={{ background: '#e07a5f', color: '#fff' }}
            onClick={handleRevertToQuotation} disabled={converting}>
            {converting ? 'Reverting...' : '⚡ Revert to Quotation'}
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
      <div id="print-area" style={{ padding: '16px 8px 100px', background: 'var(--bg)', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', maxWidth: paperSize === 'a5' ? '529px' : '763px', minWidth: 0, height: previewHeight ? previewHeight * (exporting || isExportingSingleImage ? 1 : scale) : 'auto' }}>
          <div style={{
            transform: `scale(${exporting || isExportingSingleImage ? 1 : scale})`,
            transformOrigin: 'top left',
            width: paperSize === 'a5' ? '529px' : '763px'
          }}>
            <div id="estimate-preview" ref={previewRef} style={{ display: 'flex', flexDirection: 'column', gap: '32px', width: '100%' }}>
          {pages.map((page, pageIndex) => (
            <div key={pageIndex} className="estimate-page" style={{ pageBreakAfter: page.isLast ? 'auto' : 'always', position: 'relative' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#000', background: '#fff' }}>
                <colgroup>
                  <col style={{ width: 42 }} />     {/* Sr No */}
                  <col style={{ width: 'auto' }} /> {/* Description */}
                  <col style={{ width: isChallanMode ? 55 : 42 }} />     {/* Nos. */}
                  <col style={{ width: isChallanMode ? 100 : 68 }} />     {/* Quantity */}
                  {!isChallanMode && <col style={{ width: 72 }} />}     {/* Rate */}
                  {!isChallanMode && <col style={{ width: 94 }} />}     {/* Amount */}
                </colgroup>
                <tbody>
                  {/* Title row */}
                  <tr>
                    <td colSpan={isChallanMode ? 4 : 6} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: 2, padding: '6px 0', borderBottom: '1px solid #000' }}>
                      {isChallanMode ? 'DELIVERY CHALLAN' : estimate.type === 'QUOTATION' ? 'Q U O T A T I O N' : estimate.type === 'RETURN' ? 'S A L E S   R E T U R N' : 'E S T I M A T E'}
                      {pages.length > 1 && <span style={{ fontSize: 10, fontWeight: 400, position: 'absolute', right: 8, top: 8 }}>(Page {pageIndex + 1}/{pages.length})</span>}
                    </td>
                  </tr>

                  {/* Meta details */}
                  <tr>
                    <td colSpan={isChallanMode ? 2 : 3} style={{ padding: '6px 10px', borderBottom: '1px solid #000', borderRight: '1px solid #000' }}>
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
                    <td colSpan={isChallanMode ? 2 : 3} style={{ padding: '6px 10px', borderBottom: '1px solid #000' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {[
                            ['Date', estimate.bill_date],
                            ['No.', estimate.bill_number],
                            ['Prep. By', estimate.prepared_by || ''],
                          ].map(([label, val]) => (
                            <tr key={label}>
                              <td style={{ width: 62, fontWeight: 600, paddingBottom: 2, whiteSpace: 'nowrap' }}>{label}</td>
                              <td style={{ width: 10, paddingBottom: 2 }}>:</td>
                              <td style={{ fontWeight: 400, paddingBottom: 2, whiteSpace: 'nowrap' }}>{val}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>

                  {/* Table header */}
                  <tr style={{ background: '#f0f0f0' }}>
                    {['Sr No', 'Description of Goods', 'Nos.', 'Quantity', 'Rate', 'Amount']
                      .filter(h => !isChallanMode || (h !== 'Rate' && h !== 'Amount'))
                      .map((h, i) => (
                        <td key={h} style={{
                          border: '1px solid #000', padding: '6px 4px', fontWeight: 700,
                          textAlign: h === 'Description of Goods' ? 'left' : 'center',
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                          width: h === 'Sr No' ? 42 : h === 'Description of Goods' ? 'auto' : h === 'Nos.' ? 42 : h === 'Quantity' ? 68 : h === 'Rate' ? 72 : 94
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
                      {!isChallanMode && (
                        <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>
                          {fmtMoney(page.brought.amt)}
                        </td>
                      )}
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
                      {!isChallanMode && (
                        <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'right', fontSize: 12 }}>
                          {fmtMoney(it.rate)}
                        </td>
                      )}
                      {!isChallanMode && (
                        <td style={{ border: '1px solid #000', padding: '2px 4px', textAlign: 'right', fontSize: 12 }}>
                          {fmtMoney(it.amount)}
                        </td>
                      )}
                    </tr>
                  ))}

                  {/* Empty Filler Rows */}
                  {page.emptyRowsCount > 0 && Array.from({ length: page.emptyRowsCount }).map((_, i) => (
                    <tr key={`empty-${i}`}>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', height: '22px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>
                      {!isChallanMode && <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>}
                      {!isChallanMode && <td style={{ border: '1px solid #000', padding: '2px 4px', fontSize: 12 }}>&nbsp;</td>}
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
                      {!isChallanMode && (
                        <td colSpan={2} style={{ border: '1px solid #000', padding: '4px 4px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>
                          {fmtMoney(page.carried.amt)}
                        </td>
                      )}
                    </tr>
                  )}

                  {/* Totals row (only on last page) */}
                  {page.isLast && (
                    <>
                      {estimate?.gst_percent > 0 ? (
                        <>
                          <tr style={{ background: '#f9f9f9', fontWeight: 700 }}>
                            <td colSpan={2} style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: 13 }}>Total</td>
                            <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                              {totalNos % 1 === 0 ? totalNos : totalNos.toFixed(2)}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                              {totalQty % 1 === 0 ? totalQty : totalQty.toFixed(2)}
                            </td>
                            {!isChallanMode && (
                              <>
                                <td style={{ border: '1px solid #000', padding: '6px 4px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }}>
                                  Sub Total
                                </td>
                                <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  {fmtMoney(estimate.sub_total)}
                                </td>
                              </>
                            )}
                          </tr>
                          {!isChallanMode && (
                            <>
                              <tr style={{ background: '#fcfcfc', fontStyle: 'italic' }}>
                                <td colSpan={5} style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'right', fontSize: 12 }}>GST @ {estimate.gst_percent}%</td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 13 }}>
                                  {fmtMoney(estimate.gst_amount)}
                                </td>
                              </tr>
                              <tr style={{ background: '#f9f9f9', fontWeight: 800 }}>
                                <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 8px', borderRight: 'none' }}></td>
                                <td style={{ border: '1px solid #000', borderLeft: 'none', padding: '6px 4px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }}>
                                  {estimate?.type === 'ESTIMATE' && estimate?.client_id ? 'Bill Amt' : 'Gr.Total'}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
                                  {fmtMoney(grandTotal)}
                                </td>
                              </tr>
                            </>
                          )}
                        </>
                      ) : (
                        <tr style={{ background: '#f9f9f9', fontWeight: 700 }}>
                          <td colSpan={2} style={{ border: '1px solid #000', padding: '6px 8px', textAlign: 'center', fontSize: 13 }}>Total</td>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                            {totalNos % 1 === 0 ? totalNos : totalNos.toFixed(2)}
                          </td>
                          <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'center', fontSize: 13 }}>
                            {totalQty % 1 === 0 ? totalQty : totalQty.toFixed(2)}
                          </td>
                          {!isChallanMode && (
                            <>
                              <td style={{ border: '1px solid #000', padding: '6px 4px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }}>
                                {estimate?.type === 'ESTIMATE' && estimate?.client_id ? 'Bill Amt' : 'Gr.Total'}
                              </td>
                              <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {fmtMoney(grandTotal)}
                              </td>
                            </>
                          )}
                        </tr>
                      )}
                      {estimate?.type === 'ESTIMATE' && estimate?.client_id && !isChallanMode && (
                        <>
                          <tr>
                            <td colSpan={4} style={{ border: '1px solid #000', padding: '4px 8px', borderRight: 'none' }}></td>
                            <td style={{ border: '1px solid #000', borderLeft: 'none', padding: '4px 4px', textAlign: 'right', fontSize: 13, fontStyle: 'italic' }}>Prev. Bal.</td>
                            <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right', fontSize: 13, fontStyle: 'italic' }}>
                              {fmtMoney(clientBalance - grandTotal)}
                            </td>
                          </tr>
                          <tr style={{ background: '#f1f5f9' }}>
                            <td colSpan={4} style={{ border: '1px solid #000', padding: '6px 8px', borderRight: 'none', fontWeight: 600, fontSize: 13 }}>Estimate #{estimate.bill_number}</td>
                            <td style={{ border: '1px solid #000', borderLeft: 'none', padding: '6px 4px', textAlign: 'right', fontSize: 14, fontWeight: 700 }}>Total Due</td>
                            <td style={{ border: '1px solid #000', padding: '6px 6px', textAlign: 'right', fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>
                              {fmtMoney(clientBalance)}
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
            max-width: none !important;
            width: 100% !important;
          }
          #print-area {
            padding: 0 !important;
            background: white !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            display: block !important;
            overflow: visible !important;
          }
          #print-area > div, #print-area > div > div {
            display: block !important;
            transform: none !important;
            height: auto !important;
            max-width: none !important;
            width: auto !important;
          }
          #estimate-preview {
            display: block !important;
            max-width: none !important;
            padding: 4mm 4mm 15mm 4mm !important;
            height: auto !important;
          }
          #estimate-preview table {
            width: 100% !important;
            table-layout: fixed !important;
          }
          #estimate-preview td {
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
          }
          #estimate-preview tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {ToastEl}
    </div>
  )
}
