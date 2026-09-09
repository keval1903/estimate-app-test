import { useState, useRef } from 'react'
import html2canvas from 'html2canvas'
import './App.css'

function App() {
  const [rows, setRows] = useState([
    { code: '', quantity: '' },
    { code: '', quantity: '' },
    { code: '', quantity: '' }
  ])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const resultsRef = useRef(null)

  const handleRowChange = (index, field, value) => {
    const newRows = [...rows]
    newRows[index][field] = value
    setRows(newRows)
  }

  const addRow = () => {
    setRows([...rows, { code: '', quantity: '' }])
  }

  const removeRow = (index) => {
    const newRows = rows.filter((_, i) => i !== index)
    if (newRows.length === 0) {
      newRows.push({ code: '', quantity: '' })
    }
    setRows(newRows)
  }

  const handlePaste = (e, rowIndex) => {
    const pastedData = e.clipboardData.getData('Text')
    if (!pastedData || pastedData.indexOf('\n') === -1) return // let default single-cell paste happen

    e.preventDefault()
    const lines = pastedData.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const newRows = [...rows]
    let currentRowIdx = rowIndex

    lines.forEach(line => {
      const parts = line.split(/\t+|\s{2,}/)
      const code = parts[0] || ''
      const quantity = parts[1] || ''

      if (currentRowIdx < newRows.length) {
        newRows[currentRowIdx] = { code, quantity }
      } else {
        newRows.push({ code, quantity })
      }
      currentRowIdx++
    })

    setRows(newRows)
  }

  const handleCheck = async () => {
    setError('')
    setResults([])
    setCheckedAt('')

    const requests = rows
      .filter(r => r.code.trim())
      .map(r => ({
        code: r.code.trim().toUpperCase(),
        quantity: Number(r.quantity) || 1
      }))

    // Auto-combine duplicate codes by summing their quantities
    const merged = []
    const seen = {}
    for (const req of requests) {
      if (seen[req.code] !== undefined) {
        merged[seen[req.code]].quantity += req.quantity
      } else {
        seen[req.code] = merged.length
        merged.push({ ...req })
      }
    }
    const deduped = merged

    if (deduped.length === 0) {
      setError('Please enter at least one sheet code')
      return
    }

    if (deduped.length > 25) {
      setError('Maximum 25 codes allowed per request.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: deduped })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to check availability')
      }

      setResults(data.results || [])
      if (data.checkedAt) {
        const d = new Date(data.checkedAt)
        setCheckedAt(d.toLocaleString())
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleShare = async () => {
    if (!resultsRef.current || results.length === 0) return
    try {
      const canvas = await html2canvas(resultsRef.current, { backgroundColor: '#ffffff', scale: 2 })
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
      const file = new File([blob], 'availability.png', { type: 'image/png' })

      const statusEmoji = s =>
        s === 'AVAILABLE' ? '✅' : s === 'PLEASE CONFIRM WITH US' ? '⚠️' : '❌'

      const lines = results.map(r =>
        `${statusEmoji(r.status)} *${r.code}*  Qty: ${r.requestedQuantity}  — ${r.status}`
      )

      const text = [
        `🏷️ *Laminate Stock Enquiry*`,
        `📅 ${checkedAt}`,
        ``,
        ...lines,
        ``,
        `_Note: Subject to final confirmation._`
      ].join('\n')

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Stock Check', text })
      } else {
        // Fallback download
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = 'availability.png'
        link.click()
      }
    } catch (err) {
      alert('Sharing failed: ' + err.message)
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Laminate Stock Enquiry</h1>
      </header>

      <main>
        <div className="input-section">
          <div className="table-container">
            <table className="input-table">
              <thead>
                <tr>
                  <th>Sheet Name (Code)</th>
                  <th>Quantity</th>
                  <th className="action-col"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={row.code}
                        onChange={(e) => handleRowChange(i, 'code', e.target.value)}
                        onPaste={(e) => handlePaste(e, i)}
                        placeholder="e.g. 201 SMT"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={row.quantity}
                        onChange={(e) => handleRowChange(i, 'quantity', e.target.value)}
                        placeholder="1"
                        min="1"
                      />
                    </td>
                    <td className="action-col">
                      <button className="btn-remove" onClick={() => removeRow(i)} title="Remove row">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button onClick={addRow} className="btn-secondary" type="button">+ Add Row</button>
            <button onClick={handleCheck} disabled={loading} className="btn-primary">
              {loading ? 'Checking...' : 'Check Availability'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        {results.length > 0 && (
          <div className="results-wrapper">
            <div className="results-actions">
              <button onClick={handleShare} className="btn-secondary">Share / Save Image</button>
            </div>

            <div ref={resultsRef} className="results-card">
              <h2>Availability Report</h2>
              {checkedAt && <p className="timestamp">Checked on: {checkedAt}</p>}

              <table className="results-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Req. Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className={r.status === 'AVAILABLE' ? 'status-avail' : r.status === 'PLEASE CONFIRM WITH US' ? 'status-confirm' : 'status-error'}>
                      <td>{r.code}</td>
                      <td>{r.requestedQuantity}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="footer-note">Note: This is an automated snapshot and subject to final confirmation.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
