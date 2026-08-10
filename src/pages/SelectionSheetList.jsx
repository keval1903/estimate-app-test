import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

import { isFuzzyMatch } from '../lib/searchUtils'
import { extractImageUrls, deleteImagesFromStorage } from '../lib/imageCleanup'

export default function SelectionSheetList() {
  const navigate = useNavigate()
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])

  useEffect(() => {
    fetchSheets()
  }, [])

  async function fetchSheets() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('selection_sheets')
        .select('*')
        .order('updated_at', { ascending: false })
      if (error) throw error
      setSheets(data || [])
    } catch (e) {
      alert('Error fetching sheets: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id, clientName) {
    if (!window.confirm(`Are you sure you want to delete the selection sheet for ${clientName}?`)) return
    try {
      const sheetToDelete = sheets.find(s => s.id === id)
      
      const { error } = await supabase.from('selection_sheets').delete().eq('id', id)
      if (error) throw error
      
      if (sheetToDelete && sheetToDelete.content) {
        const urls = extractImageUrls(sheetToDelete.content)
        if (urls.length > 0) {
          await deleteImagesFromStorage(urls)
        }
      }

      setSheets(sheets.filter(s => s.id !== id))
      setSelected(selected.filter(sId => sId !== id))
    } catch (e) {
      alert('Error deleting sheet: ' + e.message)
    }
  }

  async function handleDeleteSelected() {
    if (selected.length === 0) return
    if (!window.confirm(`Are you sure you want to delete ${selected.length} selected sheets?`)) return
    try {
      setLoading(true)
      
      const sheetsToDelete = sheets.filter(s => selected.includes(s.id))
      
      const { error } = await supabase.from('selection_sheets').delete().in('id', selected)
      if (error) throw error
      
      const allUrls = sheetsToDelete.flatMap(s => extractImageUrls(s.content))
      if (allUrls.length > 0) {
        await deleteImagesFromStorage(allUrls)
      }

      setSheets(sheets.filter(s => !selected.includes(s.id)))
      setSelected([])
    } catch (e) {
      alert('Error deleting selected sheets: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteAll() {
    if (sheets.length === 0) return
    if (!window.confirm('Are you sure you want to delete ALL selection sheets? This action cannot be undone.')) return
    try {
      setLoading(true)
      const allIds = sheets.map(s => s.id)
      const { error } = await supabase.from('selection_sheets').delete().in('id', allIds)
      if (error) throw error
      
      const allUrls = sheets.flatMap(s => extractImageUrls(s.content))
      if (allUrls.length > 0) {
        await deleteImagesFromStorage(allUrls)
      }

      setSheets([])
      setSelected([])
    } catch (e) {
      alert('Error deleting all sheets: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = sheets.filter(s => isFuzzyMatch(search.replace(/\s+/g, ''), s.client_name))

  const toggleSelect = (id, e) => {
    e.stopPropagation()
    if (selected.includes(id)) {
      setSelected(selected.filter(i => i !== id))
    } else {
      setSelected([...selected, id])
    }
  }

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelected(filtered.map(s => s.id))
    } else {
      setSelected([])
    }
  }

  return (
    <div className="container" style={{ paddingBottom: '80px' }}>
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">Selection Sheets</span>
      </div>

      <div style={{ padding: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          className="input"
          placeholder="Search client name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '150px', padding: '0.8rem 1rem', fontSize: '1rem' }}
        />
        <button className="btn btn-primary" onClick={() => navigate('/selection-sheets/new')}>
          + New
        </button>
      </div>

      <div style={{ padding: '0 1rem 1rem 1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={filtered.length > 0 && selected.length === filtered.length}
              onChange={toggleSelectAll}
            />
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Select All</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {selected.length > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger-color)', border: '1px solid var(--danger-color)' }} onClick={handleDeleteSelected}>
              Delete Selected ({selected.length})
            </button>
          )}
          {filtered.length > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ background: 'var(--danger-color)', color: '#fff' }} onClick={handleDeleteAll}>
              Delete All
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
          No selection sheets found.
        </div>
      ) : (
        <div style={{ padding: '0 1rem' }}>
          {filtered.map(s => (
            <div 
              key={s.id} 
              className="card" 
              style={{ marginBottom: '1rem', cursor: 'pointer', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', background: selected.includes(s.id) ? '#f0f9ff' : '#fff' }}
              onClick={() => navigate(`/selection-sheets/${s.id}`)}
            >
              <div onClick={(e) => e.stopPropagation()}>
                <input 
                  type="checkbox" 
                  style={{ transform: 'scale(1.2)' }}
                  checked={selected.includes(s.id)} 
                  onChange={(e) => toggleSelect(s.id, e)} 
                />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>{s.client_name || 'Untitled Sheet'}</h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>
                  {new Date(s.updated_at).toLocaleDateString()} {new Date(s.updated_at).toLocaleTimeString()}
                </div>
              </div>
              <button 
                className="btn btn-ghost" 
                style={{ color: 'var(--danger-color)', padding: '0.5rem' }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(s.id, s.client_name);
                }}
                title="Delete"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
