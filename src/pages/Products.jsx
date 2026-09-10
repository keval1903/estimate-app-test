import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast.jsx'

import { getMergedUnits } from '../constants/units.js'
import { isFuzzyMatch } from '../lib/searchUtils'
import { normalizeSearchQuery } from '../lib/synonyms.js'
import { useVoiceSearch } from '../hooks/useVoiceSearch.jsx'

const EMPTY_FORM = {
  product_name: '', product_code: '', keyword: '', product_group: '', length: '', width: '',
  unit: '', rate: '', calculation_type: 'QUANTITY',
  has_stock: false, stock: '', add_stock: '', min_stock: '5',
  has_remark: false, has_discount: false,
  in_ccai: false, rate_ccai: '',
  in_dc: false, rate_dc: '',
  in_laminea: false, rate_laminea: '',
  in_phs: false, rate_phs: ''
}

export default function Products() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const { activePlatform } = usePlatform()
  const { showToast, ToastEl } = useToast()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [stockMode, setStockMode] = useState('ADD') // 'ADD' or 'SET'
  const [form, setForm] = useState(EMPTY_FORM)
  const [showCustomUnit, setShowCustomUnit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState([])
  const [importDiscrepancies, setImportDiscrepancies] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const fileRef = useRef()
  const searchInputRef = useRef()

  const { isListening, startListening, stopListening, error: voiceError } = useVoiceSearch({
    onResult: (text) => {
      setSearch(text)
      if (searchInputRef.current) searchInputRef.current.focus()
    }
  })

  useEffect(() => { fetchProducts() }, [])

  useEffect(() => {
    if (products.length > 0) {
      const editId = new URLSearchParams(window.location.search).get('editId')
      if (editId) {
        const p = products.find(prod => prod.id === editId)
        if (p) openEdit(p)
      }
    }
  }, [products])

  async function fetchProducts() {
    setLoading(true)
    const [batch1, batch2] = await Promise.all ([
      supabase.from('products').select('*').order('product_name').range(0, 999),
      supabase.from('products').select('*').order('product_name').range(1000, 1999)
    ])
    if (batch1.error || batch2.error) {
      showToast('Failed to load products', 'error')
    } else {
      const allData = [...(batch1.data || []), ...(batch2.data || [])];
      const mapped = allData.map(p => ({
        ...p,
        rate: p[`rate_${activePlatform}`] !== undefined && p[`rate_${activePlatform}`] !== null ? p[`rate_${activePlatform}`] : (p.rate || 0),
        is_available: p[`in_${activePlatform}`] === true
      }));
      setProducts (mapped)
    }
    setLoading(false)
    }
  

  let s = search.trim().toLowerCase()
  s = normalizeSearchQuery(s)
  
  const sNoSpace = s.replace(/\s+/g, '')
  const searchTerms = s.split(/\s+/)
  const smartTerms = s.match(/[a-z]+|[0-9]+/g) || []

  const filtered = products.filter(p => {
    if (!showAllProducts && !p.is_available) return false;
    const pName = p.product_name.toLowerCase()
    const matchesAllTerms = searchTerms.every(term => pName.includes(term))
    const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.includes(term))
    return pName.includes(s) ||
           pName.replace(/\s+/g, '').includes(sNoSpace) ||
           p.unit.toLowerCase().includes(s) ||
           matchesAllTerms ||
           matchesSmartTerms ||
           isFuzzyMatch(sNoSpace, pName)
  })

  function openAdd() {
    setForm({ ...EMPTY_FORM, [`in_${activePlatform}`]: true })
    setEditingId(null); setStockMode('SET'); setShowCustomUnit(false); setShowModal(true)
  }

  function openEdit(p) {
    setForm({
      product_name: p.product_name, product_code: p.product_code ?? '', keyword: p.keyword ?? '', product_group: p.product_group ?? '', length: p.length ?? '',
      width: p.width ?? '', unit: p.unit, rate: p.rate,
      calculation_type: p.calculation_type,
      has_stock: p.has_stock || false, stock: p.stock ?? '', add_stock: '',
      min_stock: p.min_stock ?? 5,
      has_remark: p.has_remark || false,
      has_discount: p.has_discount || false,
      in_ccai: p.in_ccai || false, rate_ccai: p.rate_ccai ?? '',
      in_dc: p.in_dc || false, rate_dc: p.rate_dc ?? '',
      in_laminea: p.in_laminea || false, rate_laminea: p.rate_laminea ?? '',
      in_phs: p.in_phs || false, rate_phs: p.rate_phs ?? ''
    })
    setEditingId(p.id); setStockMode('ADD'); setShowCustomUnit(false); setShowModal(true)
  }

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target
    const val = type === 'checkbox' ? checked : value
    setForm(f => {
      const next = { ...f, [name]: val }
      if (name === 'unit') next.calculation_type = value === 'Sq.Ft' ? 'SQFT' : 'QUANTITY'
      if (name === 'calculation_type' && value === 'QUANTITY') { next.length = ''; next.width = '' }
      return next
    })
  }

  function validate() {
    if (!form.product_name.trim()) return 'Product name is required'
    if (!form.unit.trim()) return 'Unit is required'
    
    // Check platform rates
    const platforms = ['ccai', 'dc', 'laminea', 'phs']
    const PLATFORM_NAMES = { ccai: 'CCAI', dc: 'DC', laminea: 'Laminea', phs: 'PHS' }

    if (!platforms.some(p => form[`in_${p}`])) {
      return 'Select at least one platform'
    }

    for (const platform of platforms) {
      const rate = form[`rate_${platform}`]

      if (
        form[`in_${platform}`] &&
        (rate === '' || rate === null || !Number.isFinite(Number(rate)) || Number(rate) < 0)
      ) {
        return `${PLATFORM_NAMES[platform]} rate is required`
      }
    }
    if (form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET') {
      if (!form.length || isNaN(form.length)) return 'Length is required'
      if (!form.width  || isNaN(form.width))  return 'Width is required'
    }
    if (form.has_stock) {
      if (editingId && stockMode === 'ADD') {
        // blank means no change — not required
        if (form.add_stock !== '' && (isNaN(form.add_stock) || Number(form.add_stock) < 0)) return 'Quantity to add must be a positive number'
      } else {
        if (form.stock === '' || isNaN(form.stock)) return 'Valid stock amount is required'
      }
    }
    return null
  }

  async function handleSave() {
    const err = validate()
    if (err) { showToast(err, 'error'); return }
    setSaving(true)
    let error, data
    let targetId = editingId
    let oldStock = 0

    // If not editing, check for existing product by name to update instead of insert
    if (!targetId) {
      const existing = products.find(p => p.product_name.toLowerCase() === form.product_name.trim().toLowerCase())
      if (existing) { targetId = existing.id; oldStock = existing.stock || 0 }
    } else {
      const existing = products.find(p => p.id === targetId)
      if (existing) oldStock = existing.stock || 0
    }

    let calculatedStock = 0
    if (form.has_stock) {
      if (targetId && stockMode === 'ADD') {
        // blank add_stock = no change to current stock
        calculatedStock = form.add_stock === '' ? Number(oldStock) : Number(oldStock) + Number(form.add_stock)
      } else {
        calculatedStock = Number(form.stock)
      }
    }

    const isDimensionBased = form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET'
    const legacyRate = 
      (form.in_ccai ? Number(form.rate_ccai) : null) ??
      (form.in_dc ? Number(form.rate_dc) : null) ??
      (form.in_laminea ? Number(form.rate_laminea) : null) ??
      (form.in_phs ? Number(form.rate_phs) : null) ?? 0

    const payload = {
      product_name: form.product_name.trim().toUpperCase(),
      keyword: form.keyword ? form.keyword.trim() : null,
      product_group: form.product_group ? form.product_group.trim() : 'Uncategorized',
      unit: form.unit.trim(), 
      rate: legacyRate,
      calculation_type: form.calculation_type,
      length: isDimensionBased && form.length ? Number(form.length) : null,
      width:  isDimensionBased && form.width  ? Number(form.width)  : null,
      has_stock: form.has_stock,
      stock: calculatedStock,
      min_stock: form.has_stock ? Number(form.min_stock || 5) : 5,
      has_remark: form.has_remark,
      has_discount: form.has_discount,
      updated_at: new Date().toISOString(),
      product_code: form.product_code ? form.product_code.trim().toUpperCase() : null,
      // Use form-controlled platform toggles and rates
      in_ccai: !!form.in_ccai, rate_ccai: form.in_ccai && form.rate_ccai !== '' ? Number(form.rate_ccai) : null,
      in_dc: !!form.in_dc, rate_dc: form.in_dc && form.rate_dc !== '' ? Number(form.rate_dc) : null,
      in_laminea: !!form.in_laminea, rate_laminea: form.in_laminea && form.rate_laminea !== '' ? Number(form.rate_laminea) : null,
      in_phs: !!form.in_phs, rate_phs: form.in_phs && form.rate_phs !== '' ? Number(form.rate_phs) : null
    }

    if (targetId) {
      ;({ data, error } = await supabase.from('products').update(payload).eq('id', targetId).select().single())
    } else {
      ;({ data, error } = await supabase.from('products').insert(payload).select().single())
    }
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'error'); return }

    if (payload.has_stock) {
      const diff = payload.stock - oldStock
      if (diff !== 0 || !targetId) {
        await supabase.from('stock_history').insert({
          product_id: data.id,
          change_type: 'MANUAL_ADJUST',
          quantity_changed: diff !== 0 ? diff : payload.stock,
          platform: activePlatform
        })
      }
    }
    
    showToast(targetId ? 'Product updated ✓' : 'Product added ✓')
    setShowModal(false); fetchProducts()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) showToast('Delete failed', 'error')
    else { showToast('Product deleted'); fetchProducts() }
    setDeleteConfirm(null)
  }

  async function handleQuickAddStock(p) {
    const isPieceBased = p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET';
    const displayUnit = isPieceBased ? 'Nos.' : p.unit;
    const qtyStr = window.prompt(`Enter quantity to ADD to current stock (${p.stock} ${displayUnit}):`);
    if (!qtyStr) return;
    const qty = Number(qtyStr);
    if (isNaN(qty) || qty <= 0) {
      showToast('Please enter a valid positive number', 'error');
      return;
    }
    setSaving(true);
    const newStock = Number(p.stock || 0) + qty;
    
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', p.id);
    if (error) {
      showToast('Failed to update stock: ' + error.message, 'error');
    } else {
      await supabase.from('stock_history').insert({
        product_id: p.id,
        change_type: 'MANUAL_ADJUST',
          quantity_changed: qty,
          platform: activePlatform
        });
      showToast(`Added ${qty} ${displayUnit} to stock ✓`);
      fetchProducts();
    }
    setSaving(false);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} selected products?`)) return
    setSaving(true)

    const ids = Array.from(selectedIds)
    const chunkSize = 200
    let hasError = false

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const { error } = await supabase.from('products').delete().in('id', chunk)
      if (error) {
        hasError = true
        break
      }
    }

    setSaving(false)
    if (hasError) {
      showToast('Delete failed or partially failed', 'error')
      fetchProducts()
    } else {
      showToast(`Deleted ${selectedIds.size} products`)
      setSelectedIds(new Set())
      fetchProducts()
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setImportText(ev.target.result); parseImport(ev.target.result) }
    reader.readAsText(file)
  }


  // Helper for normalizing product names
  function normalizeProductName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase()
  }

  // Parse a CSV line properly, respecting quoted fields that may contain commas
  function parseCsvLine(line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') { inQuotes = false }
        else { current += ch }
      } else {
        if (ch === '"') { inQuotes = true }
        else if (ch === ',' || ch === '\t') { result.push(current.trim()); current = '' }
        else { current += ch }
      }
    }
    result.push(current.trim())
    return result
  }

  function parseRate(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  function parseImport(text) {
    const lines = text.trim().split('\n').filter(Boolean); const rows = []
    if (lines.length === 0) return

    // Extract headers and create a map of column names to indices
    const headerCols = parseCsvLine(lines[0]).map(c => c.toLowerCase().trim())
    const colMap = {}
    // Exact header mapping
    const EXACT_MAP = {
      'product name':     'product_name',
      'product code':     'product_code',
      'keyword':          'keyword',
      'product group':    'product_group',
      'length':           'length',
      'width':            'width',
      'unit':             'unit',
      'calculation type': 'calculation_type',
      'has stock':        'has_stock',
      'stock':            'stock',
      'min stock':        'min_stock',
      'has remark':       'has_remark',
      'has discount':     'has_discount',
      'in ccai':          'in_ccai',
      'rate ccai':        'rate_ccai',
      'in dc':            'in_dc',
      'rate dc':          'rate_dc',
      'in laminea':       'in_laminea',
      'rate laminea':     'rate_laminea',
      'in phs':           'in_phs',
      'rate phs':         'rate_phs',
    }
    headerCols.forEach((col, idx) => {
      if (EXACT_MAP[col] !== undefined) colMap[EXACT_MAP[col]] = idx
    })

    const hasDynamic = ('product_name' in colMap && 'unit' in colMap)
    
    // In-file duplicate checking sets
    const seenNames = new Set()
    const codeToNameMap = new Map()

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length < 3) continue

      let product_name, product_code, keyword, product_group, length, width, unit, calculation_type, has_stock, stock, min_stock, has_remark, has_discount
      let in_ccai, rate_ccai, in_dc, rate_dc, in_laminea, rate_laminea, in_phs, rate_phs

      if (hasDynamic) {
        if (i === 0) continue // skip header row since we mapped it
        product_name     = colMap['product_name']     !== undefined ? cols[colMap['product_name']]     : undefined
        product_code     = colMap['product_code']     !== undefined ? cols[colMap['product_code']]     : undefined
        keyword          = colMap['keyword']          !== undefined ? cols[colMap['keyword']]          : undefined
        product_group    = colMap['product_group']    !== undefined ? cols[colMap['product_group']]    : undefined
        length           = colMap['length']           !== undefined ? cols[colMap['length']]           : undefined
        width            = colMap['width']            !== undefined ? cols[colMap['width']]            : undefined
        unit             = colMap['unit']             !== undefined ? cols[colMap['unit']]             : undefined
        calculation_type = colMap['calculation_type'] !== undefined ? cols[colMap['calculation_type']] : undefined
        has_stock        = colMap['has_stock']        !== undefined ? cols[colMap['has_stock']]        : undefined
        stock            = colMap['stock']            !== undefined ? cols[colMap['stock']]            : undefined
        min_stock        = colMap['min_stock']        !== undefined ? cols[colMap['min_stock']]        : undefined
        has_remark       = colMap['has_remark']       !== undefined ? cols[colMap['has_remark']]       : undefined
        has_discount     = colMap['has_discount']     !== undefined ? cols[colMap['has_discount']]     : undefined
        in_ccai          = colMap['in_ccai']          !== undefined ? cols[colMap['in_ccai']]          : undefined
        rate_ccai        = colMap['rate_ccai']        !== undefined ? cols[colMap['rate_ccai']]        : undefined
        in_dc            = colMap['in_dc']            !== undefined ? cols[colMap['in_dc']]            : undefined
        rate_dc          = colMap['rate_dc']          !== undefined ? cols[colMap['rate_dc']]          : undefined
        in_laminea       = colMap['in_laminea']       !== undefined ? cols[colMap['in_laminea']]       : undefined
        rate_laminea     = colMap['rate_laminea']     !== undefined ? cols[colMap['rate_laminea']]     : undefined
        in_phs           = colMap['in_phs']           !== undefined ? cols[colMap['in_phs']]           : undefined
        rate_phs         = colMap['rate_phs']         !== undefined ? cols[colMap['rate_phs']]         : undefined
      } else {
        if (i === 0) continue
        continue
      }
      
      const errors = []
      const normName = normalizeProductName(product_name)
      if (!normName) errors.push('Missing product name')
      if (!unit?.trim()) errors.push('Missing unit')

      // In-file duplicate checking
      if (normName) {
        if (seenNames.has(normName)) {
          errors.push(`Duplicate Product Name in file: "${normName}"`)
        }
        seenNames.add(normName)
        
        const normCode = product_code ? product_code.trim().toUpperCase() : null
        if (normCode) {
          if (codeToNameMap.has(normCode) && codeToNameMap.get(normCode) !== normName) {
             errors.push(`Product Code "${normCode}" is assigned to multiple products in file`)
          } else {
             codeToNameMap.set(normCode, normName)
          }
        }
      }

      const parseBool = val => (typeof val === 'string' && (val.toLowerCase() === 'yes' || val.toLowerCase() === 'true')) || val === true
      
      const parsedInCcai = parseBool(in_ccai)
      const parsedInDc = parseBool(in_dc)
      const parsedInLaminea = parseBool(in_laminea)
      const parsedInPhs = parseBool(in_phs)
      
      const parsedRateCcai = parseRate(rate_ccai)
      const parsedRateDc = parseRate(rate_dc)
      const parsedRateLaminea = parseRate(rate_laminea)
      const parsedRatePhs = parseRate(rate_phs)
      
      const platformData = [
        ['CCAI', parsedInCcai, parsedRateCcai],
        ['DC', parsedInDc, parsedRateDc],
        ['Laminea', parsedInLaminea, parsedRateLaminea],
        ['PHS', parsedInPhs, parsedRatePhs]
      ]

      if (!platformData.some(([, enabled]) => enabled)) {
        errors.push('Product must be enabled for at least one platform')
      }

      for (const [name, enabled, platformRate] of platformData) {
        if (enabled && platformRate === null) {
          errors.push(`${name} rate is required`)
        }
      }

      const legacyRate = parsedRateCcai ?? parsedRateDc ?? parsedRateLaminea ?? parsedRatePhs ?? 0
      
      const ct = calculation_type?.toUpperCase().trim()
      const calcType = (ct === 'SQFT' || ct === 'INCH' || ct === 'FEET') ? ct : 'QUANTITY'
      
      const parsedHasStock = parseBool(has_stock)
      const parsedStock = parsedHasStock && !isNaN(Number(stock)) ? Number(stock) : 0
      if (parsedHasStock && isNaN(Number(stock))) errors.push(`Invalid stock value: "${stock}"`)

      const parsedMinStock = min_stock && !isNaN(Number(min_stock)) ? Number(min_stock) : 5
      const parsedHasRemark = parseBool(has_remark)
      const parsedHasDiscount = parseBool(has_discount)

      rows.push({
        product_name: normName,
        product_code: product_code ? product_code.trim().toUpperCase() : null,
        keyword: keyword ? keyword.trim() : null,
        product_group: typeof product_group === 'string' ? product_group.trim() : 'Uncategorized',
        length: length ? Number(length) : null,
        width:  width  ? Number(width)  : null,
        unit: unit ? unit.trim() : '',
        rate: legacyRate,
        calculation_type: calcType,
        has_stock: parsedHasStock, stock: parsedStock, min_stock: parsedMinStock,
        has_remark: parsedHasRemark, has_discount: parsedHasDiscount,
        in_ccai: parsedInCcai, rate_ccai: parsedInCcai ? parsedRateCcai : null,
        in_dc: parsedInDc, rate_dc: parsedInDc ? parsedRateDc : null,
        in_laminea: parsedInLaminea, rate_laminea: parsedInLaminea ? parsedRateLaminea : null,
        in_phs: parsedInPhs, rate_phs: parsedInPhs ? parsedRatePhs : null,
        errors
      })
    }

    rows.sort((a, b) => {
      const aHasErrors = a.errors && a.errors.length > 0;
      const bHasErrors = b.errors && b.errors.length > 0;
      if (aHasErrors && !bHasErrors) return -1;
      if (!aHasErrors && bHasErrors) return 1;
      return 0;
    });

    setImportPreview(rows)
  }

  async function handleImport() {
    const validRows = importPreview.filter(row => !row.errors || row.errors.length === 0)
    if (!validRows.length) { showToast('No valid rows to import', 'error'); return }
    
    setSaving(true);
    
    // Fetch all products with pagination to ensure conflict checking works fully
    showToast('Fetching database for conflict check...', 'success');
    const allDbProducts = [];
    let from = 0;
    const limit = 1000;
    while (true) {
      const { data, error } = await supabase.from('products').select('*').range(from, from + limit - 1);
      if (error) {
        showToast('Error fetching database products: ' + error.message, 'error');
        setSaving(false);
        return;
      }
      if (!data || data.length === 0) break;
      allDbProducts.push(...data);
      if (data.length < limit) break;
      from += limit;
    }

    let added = 0, updated = 0;
    let hasError = false;

    const toInsert = [];
    const toUpdate = [];

    for (const row of validRows) {
      if (row.product_code) {
        const conflict = allDbProducts.find(p => p.product_code && p.product_code.toUpperCase() === row.product_code && normalizeProductName(p.product_name) !== row.product_name);
        if (conflict) {
          showToast(`Conflict: Product Code "${row.product_code}" belongs to "${conflict.product_name}"`, 'error');
          setSaving(false);
          return;
        }
      }

      const existing = allDbProducts.find(p => normalizeProductName(p.product_name) === row.product_name);
      
      if (existing) {
        toUpdate.push({ 
          ...row, 
          id: existing.id, 
          product_code: row.product_code || existing.product_code || null
        });
        updated++;
      } else {
        toInsert.push(row);
        added++;
      }
    }

    const chunkSize = 200;

    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      const chunk = toUpdate.slice(i, i + chunkSize);
      const dbChunk = chunk.map(({ errors, ...rest }) => rest);
      const { data, error } = await supabase.from('products').upsert(dbChunk, { onConflict: 'id' }).select();
      if (error) { 
        console.error('Update error:', error);
        hasError = true; 
        break; 
      }

      const historyBatch = [];
      for (const r of data || []) {
        const previewRow = chunk.find(p => normalizeProductName(p.product_name) === normalizeProductName(r.product_name));
        const existing = allDbProducts.find(p => p.id === r.id);
        if (previewRow) {
          if (previewRow.has_stock) {
            const oldStock = existing ? (existing.stock || 0) : 0;
            const diff = previewRow.stock - oldStock;
            if (diff !== 0) {
              historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: diff, platform: activePlatform });
            }
          }
        }
      }
      if (historyBatch.length > 0) {
        const { error: histError } = await supabase.from('stock_history').insert(historyBatch);
        if (histError) console.error('History update error:', histError);
      }
    }

    if (!hasError) {
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const dbChunk = chunk.map(({ errors, ...rest }) => rest);
        const { data, error } = await supabase.from('products').insert(dbChunk).select();
        if (error) { 
          console.error('Insert error:', error);
          hasError = true; 
          break; 
        }

        const historyBatch = [];
        for (const r of data || []) {
          const previewRow = chunk.find(p => normalizeProductName(p.product_name) === normalizeProductName(r.product_name));
          if (previewRow) {
            if (previewRow.has_stock) {
              historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: previewRow.stock, platform: activePlatform });
            }
          }
        }
        if (historyBatch.length > 0) {
          const { error: histError } = await supabase.from('stock_history').insert(historyBatch);
          if (histError) console.error('History update error:', histError);
        }
      }
    }

    setSaving(false);
    if (!hasError) {
      showToast(`Import complete. Added: ${added}, Updated: ${updated}`, 'success');
      setShowImport(false);
      setImportPreview([]);
      setImportText('');
      fetchProducts();
    } else {
      showToast('Import partially failed. Check console for details.', 'error');
    }
  }

  function exportCsv(list, filename) {
    const headers = ['Product Name', 'Product Code', 'Keyword', 'Product Group', 'Length', 'Width', 'Unit', 'Calculation Type', 'Has Stock', 'Stock', 'Min Stock', 'Has Remark', 'Has Discount', 'In CCAI', 'Rate CCAI', 'In DC', 'Rate DC', 'In Laminea', 'Rate Laminea', 'In PHS', 'Rate PHS']
    const csvRows = [headers.join(',')]
    for (const p of list) {
      csvRows.push([
          `"${(p.product_name || '').replace(/"/g, '""')}"`,
          `"${(p.product_code || '').replace(/"/g, '""')}"`,
          `"${(p.keyword || '').replace(/"/g, '""')}"`,
          `"${(p.product_group || 'Uncategorized').replace(/"/g, '""')}"`,
          p.length || '',
          p.width || '',
          p.unit,
          p.calculation_type,
          p.has_stock ? 'Yes' : 'No',
          p.has_stock ? p.stock : '',
          p.min_stock || '5',
          p.has_remark ? 'Yes' : 'No',
          p.has_discount ? 'Yes' : 'No',
          p.in_ccai ? 'Yes' : 'No',
          p.in_ccai ? (p.rate_ccai ?? '') : '',
          p.in_dc ? 'Yes' : 'No',
          p.in_dc ? (p.rate_dc ?? '') : '',
          p.in_laminea ? 'Yes' : 'No',
          p.in_laminea ? (p.rate_laminea ?? '') : '',
          p.in_phs ? 'Yes' : 'No',
          p.in_phs ? (p.rate_phs ?? '') : ''
        ].join(','))
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExport() {
    const currentPlatformProducts = products.filter(p => p[`in_${activePlatform}`] === true)
    if (!currentPlatformProducts.length) { showToast('No products to export for this platform', 'error'); return }
    exportCsv(currentPlatformProducts, `products_${activePlatform}.csv`)
  }

  async function handleExportAll() {
    showToast('Fetching all products for export...', 'success')
    const allProducts = []
    let from = 0
    const limit = 1000
    while (true) {
      const { data, error } = await supabase.from('products').select('*').order('product_name', { ascending: true }).range(from, from + limit - 1)
      if (error) {
        showToast('Error fetching products: ' + error.message, 'error')
        return
      }
      if (!data || data.length === 0) break
      allProducts.push(...data)
      if (data.length < limit) break
      from += limit
    }
    if (!allProducts.length) { showToast('No products to export', 'error'); return }
    exportCsv(allProducts, 'products_all_platforms.csv')
  }

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
  }
  function toggleSelect(id) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)} title="Back">←</button>
        <button className="nav-home" onClick={() => navigate(`/${activePlatform}`)} title="Home">🏠</button>
        <span className="nav-title">Product Master</span>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
            onClick={() => navigate(`/${activePlatform}/stock-report`)}>📊 Report</button>
          {role === 'ADMIN' && (
            <>
              <button className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
                onClick={handleExport}>⬇ Export</button>
              <button className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
                onClick={handleExportAll}>⬇ Export All</button>
              <button className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)' }}
                onClick={() => setShowImport(true)}>⬆ Import</button>
            </>
          )}
        </div>
      </div>
      <div style={{ background: '#f8fafc', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0' }}>
         <input type="checkbox" id="showAll" checked={showAllProducts} onChange={e => setShowAllProducts(e.target.checked)} />
         <label htmlFor="showAll" style={{ fontSize: '0.875rem', color: '#475569', cursor: 'pointer' }}>Show products not available in {PLATFORM_NAMES[activePlatform]}</label>
      </div>
      <div className="page">
        <div className="search-bar" style={{ position: 'relative' }}>
          <span>🔍</span>
          <input 
            ref={searchInputRef}
            placeholder="Search or tap mic..."
            value={search} onChange={e => setSearch(e.target.value)} 
            style={{ paddingRight: search ? 60 : 40 }}
          />
          <div style={{ position: 'absolute', right: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
            {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>✕</button>}
            <button 
              type="button"
              className={`btn btn-ghost btn-sm ${isListening ? 'listening pulse-mic' : ''}`}
              style={{ color: isListening ? 'var(--danger-color)' : 'var(--text-muted)' }}
              onPointerDown={(e) => { 
                e.preventDefault();
                e.stopPropagation();
                if (isListening) stopListening(); else startListening(); 
              }}
              title={voiceError || 'Voice Search'}
            >
              {isListening ? '🛑' : '🎤'}
            </button>
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <span className="section-label">{filtered.length} Products</span>
          {filtered.length > 0 && role === 'ADMIN' && (
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

        {loading ? <div className="spinner" /> : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <p>{search ? 'No products match your search' : 'No products yet. Tap + ADD PRODUCT below!'}</p>
          </div>
        ) : filtered.map(p => (
          <div key={p.id} className="item-card" style={{ border: selectedIds.has(p.id) ? '2px solid var(--primary-color)' : '1px solid var(--border-light)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 }}>
                {role === 'ADMIN' && (
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                )}
                <div className="item-name">{p.product_name}</div>
              </div>
              <span className={`badge ${p.calculation_type === 'SQFT' ? 'badge-sqft' : 'badge-qty'}`}>
                {p.calculation_type}
              </span>
            </div>
            <div className="item-grid" style={{ marginTop:8, marginLeft: 26 }}>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>GROUP</span><br />{p.product_group || 'Uncategorized'}</div>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>UNIT</span><br />{p.unit}</div>
              <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>RATE</span><br />₹{Number(p.rate).toFixed(2)}</div>
              {(p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET') && (p.length || p.width) && (
                <>
                  <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>LENGTH</span><br />{p.length} {p.calculation_type === 'INCH' || p.calculation_type === 'FEET' ? (p.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}</div>
                  <div><span style={{ color:'var(--text-muted)', fontSize:12 }}>WIDTH</span><br />{p.width} {p.calculation_type === 'INCH' || p.calculation_type === 'FEET' ? (p.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}</div>
                </>
              )}
              {p.has_stock && (
                <div>
                  <span style={{ color:'var(--text-muted)', fontSize:12 }}>STOCK</span><br />
                  <span style={{ fontWeight: 600, color: p.stock > 0 ? 'var(--primary-color)' : 'var(--danger-color)' }}>
                    {p.stock}
                  </span>
                </div>
              )}
            </div>
            <div className="item-actions" style={{ marginLeft: 26 }}>
              {p.has_stock && (
                <button className="btn btn-primary btn-sm" style={{ background: '#10b981' }} onClick={() => handleQuickAddStock(p)}>
                  ➕ Stock
                </button>
              )}
              {role === 'ADMIN' && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>✏️ Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#ef4444' }} onClick={() => setDeleteConfirm(p)}>🗑 Delete</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {role === 'ADMIN' && (
        <div className="sticky-bottom">
          <div className="sticky-bottom-inner">
            <button className="btn btn-primary btn-full btn-lg" onClick={openAdd}>+ ADD PRODUCT</button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>{editingId ? 'Edit Product' : 'Add Product'}</span>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="field">
              <label>Product Name *</label>
              <input name="product_name" value={form.product_name} onChange={handleFormChange}
                placeholder="e.g. C PLY 4 18 MM 7 x 4" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="field">
              <label>Product Code <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(Required to use in Alternative Codes)</span></label>
              <input name="product_code" value={form.product_code || ''} onChange={handleFormChange}
                placeholder="e.g. 201 SMT" style={{ textTransform:'uppercase' }} />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Product Group</label>
                <input name="product_group" value={form.product_group || ''} onChange={handleFormChange}
                  placeholder="e.g. Hardware, Plywood" />
              </div>
              <div className="field">
                <label>Highlight Keyword (Optional)</label>
                <input name="keyword" value={form.keyword || ''} onChange={handleFormChange}
                  placeholder="e.g. PLYWOOD or SPECIAL OFFER" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Unit *</label>
                {!showCustomUnit ? (
                  <select name="unit" value={form.unit} onChange={e => {
                    if (e.target.value === 'ADD_CUSTOM') {
                      setShowCustomUnit(true)
                      setForm(f => ({ ...f, unit: '' }))
                    } else {
                      handleFormChange(e)
                    }
                  }}>
                    <option value="">Select unit</option>
                    {getMergedUnits(products).map(u => <option key={u} value={u}>{u}</option>)}
                    <option value="ADD_CUSTOM">➕ Add Custom Unit...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input name="unit" value={form.unit} onChange={handleFormChange}
                      placeholder="Type custom unit (e.g. Sheet, Gram, Dozen)" autoFocus />
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowCustomUnit(false)}>✕</button>
                  </div>
                )}
              </div>
              <div className="field">
                <label>Calculation Type *</label>
                <select name="calculation_type" value={form.calculation_type} onChange={handleFormChange}>
                  <option value="QUANTITY">QUANTITY</option>
                  <option value="SQFT">SQFT</option>
                  <option value="INCH">INCH</option>
                  <option value="FEET">FEET</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="section-label" style={{ marginBottom: 8 }}>Platform Availability &amp; Rates</div>
              {['ccai', 'dc', 'laminea', 'phs'].map(p => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120, cursor: 'pointer', fontWeight: 600, textTransform: 'uppercase', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={!!form[`in_${p}`]}
                      onChange={e => setForm(f => ({ ...f, [`in_${p}`]: e.target.checked }))}
                      style={{ width: 15, height: 15 }}
                    />
                    {PLATFORM_NAMES[p] || p}
                  </label>
                  <input
                    type="number" inputMode="decimal"
                    placeholder="Rate"
                    value={form[`rate_${p}`] ?? ''}
                    onChange={e => setForm(f => ({ ...f, [`rate_${p}`]: e.target.value }))}
                    style={{ width: 100 }}
                  />
                </div>
              ))}
            </div>
            {(form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET') && (
              <div className="field-row">
                <div className="field">
                  <label>Length ({form.calculation_type === 'INCH' ? 'in' : 'ft'}) *</label>
                  <input name="length" type="number" inputMode="decimal"
                    value={form.length} onChange={handleFormChange} placeholder="e.g. 12" />
                </div>
                <div className="field">
                  <label>Width ({form.calculation_type === 'INCH' ? 'in' : 'ft'}) *</label>
                  <input name="width" type="number" inputMode="decimal"
                    value={form.width} onChange={handleFormChange} placeholder="e.g. 8" />
                </div>
              </div>
            )}
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_stock" checked={!!form.has_stock} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Manage Stock for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_remark" checked={!!form.has_remark} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Ask Remark / Extra Note for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_discount" checked={!!form.has_discount} onChange={handleFormChange} style={{ width: 16, height: 16 }} />
                Allow Discount for this product
              </label>
            </div>
            {form.has_stock && (
              <div className="field">
                {editingId && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${stockMode === 'ADD' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setStockMode('ADD')}
                      style={{ flex: 1 }}
                    >
                      ➕ Add Stock (+)
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${stockMode === 'SET' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setStockMode('SET')}
                      style={{ flex: 1 }}
                    >
                      ✏️ Set Exact (=)
                    </button>
                  </div>
                )}

                {editingId && stockMode === 'ADD' ? (
                  <>
                    <label>Quantity to Add (+)</label>
                    <input name="add_stock" type="number" inputMode="decimal"
                      value={form.add_stock} onChange={handleFormChange} placeholder="e.g. 10 to add 10 more" />
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 6, fontWeight: 700 }}>
                      Current: {form.stock || 0} → New Total: {Number(form.stock || 0) + (Number(form.add_stock) || 0)} {form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET' ? 'Nos.' : form.unit}
                    </div>
                  </>
                ) : (
                  <>
                    <label>{editingId ? 'Set Total Stock (=)' : 'Current Stock *'}</label>
                    <input name="stock" type="number" inputMode="decimal"
                      value={form.stock} onChange={handleFormChange} placeholder="e.g. 100" />
                    {editingId && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Current Stock in system: {form.stock || 0} {form.calculation_type === 'SQFT' || form.calculation_type === 'INCH' || form.calculation_type === 'FEET' ? 'Nos.' : form.unit}
                      </div>
                    )}
                  </>
                )}

                <div style={{ marginTop: 12 }}>
                  <label>Minimum Stock Level * (Reorder Alert Limit)</label>
                  <input name="min_stock" type="number" inputMode="decimal"
                    value={form.min_stock} onChange={handleFormChange} placeholder="e.g. 5" />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Alert is triggered when stock falls below this quantity
                  </div>
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:10, marginTop:8 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editingId ? 'Update Product' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal-box">
            <div className="modal-title">Delete Product</div>
            <p style={{ marginBottom:16 }}>
              Delete <strong>{deleteConfirm.product_name}</strong>? Old estimates will not be affected.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-full" onClick={() => handleDelete(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {importDiscrepancies.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 600 }}>
            <div className="modal-title">
              <span style={{ color: 'var(--warning-dark, #b54708)' }}>Data Discrepancy Report</span>
              <button className="btn btn-ghost" onClick={() => setImportDiscrepancies([])}>✕</button>
            </div>
            <div style={{ marginBottom: 16, fontSize: 14 }}>
              The database altered the following values during save. This usually happens if a number was rounded by the database schema.
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-50)' }}>
                    <th style={{ padding: '8px' }}>Product</th>
                    <th style={{ padding: '8px' }}>Field</th>
                    <th style={{ padding: '8px' }}>Raw (Sent)</th>
                    <th style={{ padding: '8px' }}>Saved (DB)</th>
                  </tr>
                </thead>
                <tbody>
                  {importDiscrepancies.map((d, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                      <td style={{ padding: '8px' }}>{d.product_name}</td>
                      <td style={{ padding: '8px' }}>{d.field}</td>
                      <td style={{ padding: '8px', color: 'var(--danger)' }}>{d.expected}</td>
                      <td style={{ padding: '8px', color: 'var(--success)' }}>{d.saved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={() => setImportDiscrepancies([])}>
              Acknowledge
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowImport(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Import Products (CSV)</span>
              <button className="btn btn-ghost" onClick={() => setShowImport(false)}>✕</button>
            </div>
            <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:12 }}>
              Columns: <strong>Product Name, Length, Width, Unit, Rate, Calculation Type, Has Stock, Stock</strong><br />
              Leave Length/Width blank for QUANTITY products. "Has Stock" should be Yes/No.
            </p>
            <div className="field">
              <label>Upload CSV File</label>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileChange}
                style={{ padding:'10px 0', border:'none', fontSize:14 }} />
            </div>
            <div className="field">
              <label>Or Paste CSV Text</label>
              <textarea rows={5}
                style={{ width:'100%', padding:12, border:'2px solid var(--border-light)', borderRadius:8, fontSize:13, fontFamily:'monospace' }}
                placeholder={"C PLY 4 18 MM 7 x 4,7,4,Sq.Ft,57.50,SQFT\nNAILS 14 X 1 3/4,,,Kg.,130,QUANTITY"}
                value={importText}
                onChange={e => { setImportText(e.target.value); parseImport(e.target.value) }} />
            </div>
            {importPreview.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div className="section-label">
                  {importPreview.length} rows parsed 
                  {importPreview.some(r => r.errors?.length > 0) && <span style={{ color:'var(--danger)', marginLeft:8 }}>(Contains errors)</span>}
                </div>
                <div style={{ maxHeight:160, overflowY:'auto', fontSize:13 }}>
                  {importPreview.map((r,i) => (
                    <div key={i} style={{ padding:'6px 0', borderBottom:'1px solid #f0f0f0', color: r.errors?.length ? 'var(--danger)' : 'inherit' }}>
                      <strong>{r.product_name || 'Missing Name'}</strong> — {r.unit || 'No Unit'} @ ₹{r.raw_rate}
                      {r.calculation_type === 'SQFT' && ` (${r.length}×${r.width} ft)`}
                      {r.errors?.length > 0 && (
                        <div style={{ fontSize: 11, marginTop: 4 }}>
                          {r.errors.map((e, idx) => <div key={idx}>⚠ {e}</div>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleImport}
                disabled={saving || importPreview.length === 0 || importPreview.some(r => r.errors?.length > 0)}>
                {saving ? 'Importing...' : `Import ${importPreview.length} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ToastEl}
    </div>
  )
}
