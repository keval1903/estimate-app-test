import { useState, useRef } from 'react'
import html2canvas from 'html2canvas'
import './App.css'

function App() {
  const [pasteData, setPasteData] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const resultsRef = useRef(null)

  const handleCheck = async () => {
    setError('')
    setResults([])
    setCheckedAt('')
    
    if (!pasteData.trim()) {
      setError('Please enter some codes')
      return
    }

    // Parse input: expects "Code [tab/space] Quantity" or just lines of codes
    const lines = pasteData.split('\n').map(l => l.trim()).filter(Boolean)
    const requests = lines.map(line => {
      // Split by tab or multiple spaces
      const parts = line.split(/\t+|\s{2,}/)
      if (parts.length >= 2) {
        return { code: parts[0].trim(), quantity: Number(parts[1]) || 1 }
      }
      return { code: line, quantity: 1 }
    })

    if (requests.length > 25) {
      setError('Maximum 25 codes allowed per request.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
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
      
      const text = `Stock Availability Check - ${checkedAt}`

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
        <h1>Code Availability Finder</h1>
        <p>Paste codes from Excel (Code column and Quantity column)</p>
      </header>
      
      <main>
        <div className="input-section">
          <textarea 
            value={pasteData}
            onChange={(e) => setPasteData(e.target.value)}
            placeholder="201 SMT    5&#10;202 SMT    15"
            rows={6}
          />
          <button onClick={handleCheck} disabled={loading} className="btn-primary">
            {loading ? 'Checking...' : 'Check Availability'}
          </button>
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
