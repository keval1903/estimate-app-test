import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast.jsx'
import { getMergedUnits } from '../constants/units.js'
import { isFuzzyMatch } from '../lib/searchUtils'
import { normalizeSearchQuery } from '../lib/synonyms.js'
import { useVoiceSearch } from '../hooks/useVoiceSearch.jsx'

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayIST() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const dd = String(ist.getDate()).padStart(2, '0')
  const mm = String(ist.getMonth() + 1).padStart(2, '0')
  const yyyy = ist.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

function calcItem(item) {
  const rate = parseFloat(item.rate) || 0
  const nos = parseFloat(item.nos) || 0
  const qty = parseFloat(item.quantity) || 0
  const L = parseFloat(item.length_snapshot)
  const W = parseFloat(item.width_snapshot)
  if (item.calculation_type_snapshot === 'SQFT') {
    const lVal = isNaN(L) ? 0 : L
    const wVal = isNaN(W) ? 0 : W
    const quantity = lVal * wVal * nos
    const amount = Math.ceil(quantity * rate)
    return { quantity: +quantity.toFixed(2), amount: amount }
  } else if (item.calculation_type_snapshot === 'INCH' || item.calculation_type_snapshot === 'FEET') {
    const lVal = isNaN(L) || L <= 0 ? 1 : L
    const wVal = isNaN(W) || W <= 0 ? 1 : W
    const amount = Math.ceil(lVal * wVal * nos * rate)
    const quantity = nos
    return { quantity: +quantity.toFixed(2), amount: amount }
  } else {
    const amount = Math.ceil(qty * rate)
    return { quantity: qty, amount: amount }
  }
}

function calcTotals(items, gstRate = 0) {
  const roundedGstRate = Math.round(gstRate);
  let total_nos = 0, total_quantity = 0, sub_total = 0
  for (const it of items) {
    const fresh = calcItem(it)
    const amt = fresh.amount ?? parseFloat(it.amount) ?? 0
    const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
    total_nos += isPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0);
    total_quantity += parseFloat(it.quantity) || 0
    sub_total += amt
  }
  const gst_amount = Math.round(sub_total * (roundedGstRate / 100))
  const grand_total = sub_total + gst_amount
  return {
    total_nos: +total_nos.toFixed(2),
    total_quantity: +total_quantity.toFixed(2),
    sub_total: +sub_total.toFixed(2),
    gst_percent: roundedGstRate,
    gst_amount: gst_amount,
    grand_total: +grand_total.toFixed(2)
  }
}

const EMPTY_ITEM = {
  product_id: null, product_name_snapshot: '',
  length_snapshot: null, width_snapshot: null,
  nos: '', quantity: '', unit_snapshot: '',
  rate: '', base_rate: '', discount_percent: '', calculation_type_snapshot: 'QUANTITY', amount: 0,
  has_stock: false, stock: 0, has_remark: false, remark: '', has_discount: false, keyword_snapshot: ''
}

const EMPTY_PRODUCT_FORM = {
  product_name: '', keyword: '', length: '', width: '',
  unit: '', rate: '', calculation_type: 'QUANTITY',
  has_stock: false, stock: '', min_stock: '5', has_remark: false, has_discount: false
}
const UNITS = ['Sq.Ft', 'Nos.', 'Kg.', 'Bundle', 'Rmt', 'Ltr', 'Pkt', 'Box', 'Set', 'Pair']

// ── Main Component ────────────────────────────────────────────────────────────
export default function CreateEstimate() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { showToast, ToastEl } = useToast()

  const [docType, setDocType] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('type')
    return p === 'RETURN' ? 'RETURN' : p === 'ESTIMATE' ? 'ESTIMATE' : 'QUOTATION'
  })
  const [billDate, setBillDate] = useState(todayIST())
  const [clientName, setClientName] = useState('')
  const [clientMobile, setClientMobile] = useState('')
  const [orderBy, setOrderBy] = useState('')
  const [preparedBy, setPreparedBy] = useState('')
  const [siteName, setSiteName] = useState('')
  const [items, setItems] = useState([])
  const [originalItems, setOriginalItems] = useState([])
  const [gstPercent, setGstPercent] = useState('')
  const [totals, setTotals] = useState({ total_nos: 0, total_quantity: 0, sub_total: 0, gst_percent: 0, gst_amount: 0, grand_total: 0 })
  const [existingBillNumber, setExistingBillNumber] = useState(null)

  // UI state
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItemIdx, setEditingItemIdx] = useState(null)
  const [isDraftRestored, setIsDraftRestored] = useState(false)
  const [previousBalance, setPreviousBalance] = useState('')

  const skipAutoSaveRef = useRef(false)

  // item modal state
  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const [bulkAddMode, setBulkAddMode] = useState(false)
  const [bulkSelectedItems, setBulkSelectedItems] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [productSuggestions, setProductSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionIdx, setSuggestionIdx] = useState(-1)
  const [allProducts, setAllProducts] = useState([])

  // new product state
  const [showProductModal, setShowProductModal] = useState(false)
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM)
  const [showProductCustomUnit, setShowProductCustomUnit] = useState(false)
  const [savingProduct, setSavingProduct] = useState(false)

  const { isListening, startListening, error: voiceError } = useVoiceSearch({
    onResult: (text) => {
      setProductSearch(text)
      setShowSuggestions(true)
      if (productInputRef.current) productInputRef.current.focus()
    }
  })

  // ── Clients Data ──
  const [allClients, setAllClients] = useState([])

  // ── Form State ──autocomplete
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)
  const [clientSuggestionIdx, setClientSuggestionIdx] = useState(-1)
  const [siteSuggestions, setSiteSuggestions] = useState([])
  const [showSiteSuggestions, setShowSiteSuggestions] = useState(false)
  const [siteSuggestionIdx, setSiteSuggestionIdx] = useState(-1)
  const [allSites, setAllSites] = useState([])

  const productInputRef = useRef()
  const clientInputRef = useRef()
  const siteInputRef = useRef()
  const nosInputRef = useRef()
  const qtyInputRef = useRef()

  //── Load products & sites ──
  useEffect(() => {
    Promise.all([
      supabase.from('products').select('*').order('product_name').range(0, 999),
      supabase.from('products').select('*').order('product_name').range(1000, 1999)
    ]).then(([batch1, batch2]) => {
      setAllProducts([...(batch1.data || []), ...(batch2.data || [])])
    })
    supabase.from('sites').select('*').order('site_name')
      .then(({ data }) => setAllSites(data || []))
  }, [])


  const draftKey = isEdit ? `estimate_draft_${id}` : 'estimate_draft_new'

  // ── Load existing estimate or draft ──
  useEffect(() => {
    async function load() {
      let parsedDraft = null
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        try { parsedDraft = JSON.parse(savedDraft) } catch (e) { }
      }

      if (isEdit) {
        setLoading(true)
        const { data: est, error } = await supabase
          .from('estimates').select('*').eq('id', id).single()
        if (error || !est) { showToast('Estimate not found', 'error'); navigate('/estimates'); return }

        if (parsedDraft) {
          setBillDate(parsedDraft.billDate)
          setClientName(parsedDraft.clientName || parsedDraft.transport || '')
          setClientMobile(parsedDraft.clientMobile || '')
          setOrderBy(parsedDraft.orderBy || '')
          setPreparedBy(parsedDraft.preparedBy || '')
          setSiteName(parsedDraft.siteName || '')
          setItems(parsedDraft.items || [])
          setGstPercent(parsedDraft.gstPercent || '')
          setIsDraftRestored(true)
          setTimeout(() => showToast('Unsaved draft restored'), 500)
        } else {
          setBillDate(est.bill_date)
          setClientName(est.client_name || est.transport || '')
          setClientMobile(est.client_mobile || '')
          setOrderBy(est.order_by || '')
          setPreparedBy(est.prepared_by || '')
          setSiteName(est.site_name || '')
          setDocType(est.type || 'ESTIMATE')
          setPreviousBalance(est.previous_balance != null ? est.previous_balance : '')
          setGstPercent(est.gst_percent ? String(est.gst_percent) : '')
          const { data: eitems } = await supabase
            .from('estimate_items').select('*')
            .eq('estimate_id', id).order('serial_number')
          const loadedItems = (eitems || []).map(it => ({
            id: it.id,
            product_id: it.product_id,
            product_name_snapshot: it.product_name_snapshot,
            length_snapshot: it.length_snapshot,
            width_snapshot: it.width_snapshot,
            nos: it.nos ?? '',
            quantity: it.quantity ?? '',
            unit_snapshot: it.unit_snapshot,
            rate: it.rate,
            discount_percent: it.discount_percent ?? '',
            calculation_type_snapshot: it.calculation_type_snapshot,
            amount: it.amount,
            remark: it.remark || ''
          }))
          setItems(loadedItems)
          setOriginalItems(loadedItems)
        }
        setExistingBillNumber(est.bill_number)
        setLoading(false)
      } else {
        if (parsedDraft) {
          setBillDate(parsedDraft.billDate)
          setClientName(parsedDraft.clientName || parsedDraft.transport || '')
          setClientMobile(parsedDraft.clientMobile || '')
          setOrderBy(parsedDraft.orderBy || '')
          setPreparedBy(parsedDraft.preparedBy || '')
          setSiteName(parsedDraft.siteName || '')
          setItems(parsedDraft.items || [])
          setGstPercent(parsedDraft.gstPercent || '')
          setIsDraftRestored(true)
          setTimeout(() => showToast('Unsaved draft restored'), 500)
        }
        setLoading(false)
      }
    }
    load()

    // Load clients for autocomplete
    async function loadClientNames() {
      const { data: cData } = await supabase.from('clients').select('id, name, mobile')
      const { data: eData } = await supabase.from('estimates').select('client_name, client_mobile')
      const cmap = new Map()
      if (cData) cData.forEach(c => {
        if (c.name) cmap.set(c.name.trim().toUpperCase(), { id: c.id, mobile: c.mobile || '' })
      })
      if (eData) eData.forEach(e => {
        if (e.client_name) {
          const n = e.client_name.trim().toUpperCase()
          if (!cmap.has(n)) cmap.set(n, { id: null, mobile: e.client_mobile || '' })
        }
      })
      const merged = Array.from(cmap.entries()).map(([name, val]) => ({ name, id: val.id, mobile: val.mobile })).sort((a, b) => a.name.localeCompare(b.name))
      setAllClients(merged)
    }
    loadClientNames()
  }, [id])

  async function fetchClientCurrentBalance(clientId) {
    if (!clientId) {
      setPreviousBalance('')
      return
    }
    try {
      const { data: estData } = await supabase.from('estimates').select('grand_total, type').eq('client_id', clientId).in('type', ['ESTIMATE', 'DELETED_ESTIMATE', 'RETURN', 'DELETED_RETURN'])
      const { data: payData } = await supabase.from('payments').select('amount').eq('client_id', clientId)
      const { data: cData } = await supabase.from('clients').select('opening_balance').eq('id', clientId).single()

      const estTotal = (estData || []).filter(e => e.type === 'ESTIMATE' || e.type === 'DELETED_ESTIMATE').reduce((sum, e) => sum + Number(e.grand_total || 0), 0)
      const returnTotal = (estData || []).filter(e => e.type === 'RETURN' || e.type === 'DELETED_RETURN').reduce((sum, e) => sum + Number(e.grand_total || 0), 0)
      const payTotal = (payData || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
      const bal = Number(cData?.opening_balance || 0) + estTotal - returnTotal - payTotal
      setPreviousBalance(bal.toString())
    } catch (e) {
      console.error('Failed to fetch client balance', e)
    }
  }

  // ── Auto-save draft ──
  useEffect(() => {
    if (!loading) {
      if (skipAutoSaveRef.current) {
        skipAutoSaveRef.current = false
        return
      }
      localStorage.setItem(draftKey, JSON.stringify({
        billDate, clientName, clientMobile, orderBy, preparedBy, siteName, items, gstPercent
      }))
    }
  }, [docType, billDate, clientName, clientMobile, orderBy, preparedBy, siteName, items, gstPercent, draftKey, loading])

  // ── Discard Draft & Reset ──
  const handleDiscardDraft = async () => {
    skipAutoSaveRef.current = true
    localStorage.removeItem(draftKey)
    setIsDraftRestored(false)

    if (isEdit) {
      setLoading(true)
      const { data: est } = await supabase
        .from('estimates').select('*').eq('id', id).single()
      if (est) {
        setBillDate(est.bill_date)
        setClientName(est.client_name || est.transport || '')
        setClientMobile(est.client_mobile || '')
        setOrderBy(est.order_by || '')
        setPreparedBy(est.prepared_by || '')
        setSiteName(est.site_name || '')
        setDocType(est.type || 'ESTIMATE')
        setGstPercent(est.gst_percent ? String(est.gst_percent) : '')
        const { data: eitems } = await supabase
          .from('estimate_items').select('*')
          .eq('estimate_id', id).order('serial_number')
        const loadedItems = (eitems || []).map(it => ({
          id: it.id,
          product_id: it.product_id,
          product_name_snapshot: it.product_name_snapshot,
          length_snapshot: it.length_snapshot,
          width_snapshot: it.width_snapshot,
          nos: it.nos ?? '',
          quantity: it.quantity ?? '',
          unit_snapshot: it.unit_snapshot,
          rate: it.rate,
          calculation_type_snapshot: it.calculation_type_snapshot,
          amount: it.amount,
          remark: it.remark || ''
        }))
        setItems(loadedItems)
        setOriginalItems(loadedItems)
      }
      setLoading(false)
    } else {
      setBillDate(todayIST())
      setClientName('')
      setClientMobile('')
      setOrderBy('')
      setPreparedBy('')
      setSiteName('')
      setItems([])
      setGstPercent('')
    }
    localStorage.removeItem(draftKey)
    showToast('Unsaved draft discarded')
  }

  // ── Recalc totals when items change ──
  useEffect(() => { setTotals(calcTotals(items, parseFloat(gstPercent) || 0)) }, [items, gstPercent])
  // ── Product search ──
  useEffect(() => {
    let q = productSearch.trim().toLowerCase()
    q = normalizeSearchQuery(q)

    if (!q) {
      setProductSuggestions(allProducts)
      setSuggestionIdx(-1)
      return
    }
    const searchTerms = q.split(/\s+/)
    const smartTerms = q.match(/[a-z]+|[0-9]+/g) || []

    const results = allProducts.filter(p => {
      const pName = p.product_name.toLowerCase()
      const matchesAllTerms = searchTerms.every(term => pName.includes(term))
      const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => pName.includes(term))

      return pName.includes(q) ||
        pName.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
        matchesAllTerms ||
        matchesSmartTerms ||
        isFuzzyMatch(q.replace(/\s+/g, ''), pName)
    })
    setProductSuggestions(results)
    setSuggestionIdx(-1)
  }, [productSearch, allProducts])

  // ── Client search ──
  useEffect(() => {
    const qRaw = clientName.trim().toLowerCase()
    const q = qRaw.replace(/\s+/g, '')
    if (!q) {
      setClientSuggestions([])
      setShowClientSuggestions(false)
      setClientSuggestionIdx(-1)
      return
    }
    const searchTerms = qRaw.split(/\s+/)
    const smartTerms = qRaw.match(/[a-z]+|[0-9]+/g) || []

    const results = allClients.filter(c => {
      const cName = c.name.toLowerCase()
      const matchesAllTerms = searchTerms.every(term => cName.includes(term))
      const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => cName.includes(term))
      return cName.includes(qRaw) ||
        cName.replace(/\s+/g, '').includes(q) ||
        matchesAllTerms || matchesSmartTerms ||
        isFuzzyMatch(q, cName)
    }).slice(0, 8)
    setClientSuggestions(results)
    setClientSuggestionIdx(-1)
  }, [clientName, allClients])

  // ── Site search ──
  useEffect(() => {
    const qRaw = siteName.trim().toLowerCase()
    const q = qRaw.replace(/\s+/g, '')
    if (!qRaw) {
      setSiteSuggestions(allSites.slice(0, 8))
      return
    }
    const searchTerms = qRaw.split(/\s+/)
    const smartTerms = qRaw.match(/[a-z]+|[0-9]+/g) || []

    const results = allSites.filter(s => {
      const sName = s.site_name.toLowerCase()
      const matchesAllTerms = searchTerms.every(term => sName.includes(term))
      const matchesSmartTerms = smartTerms.length > 0 && smartTerms.every(term => sName.includes(term))
      return sName.includes(qRaw) ||
        sName.replace(/\s+/g, '').includes(q) ||
        matchesAllTerms || matchesSmartTerms ||
        isFuzzyMatch(q, sName)
    }).slice(0, 8)
    setSiteSuggestions(results)
  }, [siteName, allSites])

  // ── Select a product from suggestions ──
  function selectProduct(p) {
    const isPieceBased = p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET'
    const baseRate = parseFloat(p.rate) || 0

    if (bulkAddMode) {
      if (bulkSelectedItems.some(it => it.product_id === p.id)) {
        setBulkSelectedItems(prev => prev.filter(it => it.product_id !== p.id))
        return
      }
      const nextItem = {
        product_id: p.id,
        product_name_snapshot: p.product_name,
        length_snapshot: p.length,
        width_snapshot: p.width,
        unit_snapshot: p.unit,
        base_rate: baseRate,
        discount_percent: '',
        rate: baseRate,
        calculation_type_snapshot: p.calculation_type,
        nos: isPieceBased ? '1' : '',
        quantity: p.calculation_type === 'QUANTITY' ? '1' : '',
        amount: 0,
        has_stock: p.has_stock || false,
        stock: p.stock || 0,
        has_remark: p.has_remark || false,
        has_discount: p.has_discount || false,
        keyword_snapshot: p.keyword || ''
      }
      const { quantity, amount } = calcItem(nextItem)
      nextItem.quantity = quantity || 1
      nextItem.amount = amount

      setBulkSelectedItems(prev => [...prev, nextItem])
      return
    }

    setItemForm(f => {
      const next = {
        ...f,
        product_id: p.id,
        product_name_snapshot: p.product_name,
        length_snapshot: p.length,
        width_snapshot: p.width,
        unit_snapshot: p.unit,
        base_rate: baseRate,
        discount_percent: '',
        rate: baseRate,
        calculation_type_snapshot: p.calculation_type,
        nos: isPieceBased ? (f.nos || '') : '',
        quantity: p.calculation_type === 'QUANTITY' ? (f.quantity || '') : (f.nos || ''),
        amount: 0,
        has_stock: p.has_stock || false,
        stock: p.stock || 0,
        has_remark: p.has_remark || false,
        has_discount: p.has_discount || false,
        keyword_snapshot: p.keyword || ''
      }
      // recalc immediately
      const { quantity, amount } = calcItem(next)
      next.quantity = quantity || ''
      next.amount = amount
      return next
    })
    setProductSearch(p.product_name)
    setShowSuggestions(false)
    setProductSuggestions([])
    setSuggestionIdx(-1)

    setTimeout(() => {
      if (isPieceBased) nosInputRef.current?.focus()
      else qtyInputRef.current?.focus()
    }, 50)
  }

  function handleProductKeyDown(e) {
    if (!showSuggestions || productSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSuggestionIdx(prev => (prev < productSuggestions.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSuggestionIdx(prev => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      let selected = productSuggestions[0]
      if (suggestionIdx >= 0 && suggestionIdx < productSuggestions.length) {
        selected = productSuggestions[suggestionIdx]
      }
      if (selected) selectProduct(selected)
    }
  }

  function handleClientKeyDown(e) {
    if (!showClientSuggestions || clientSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setClientSuggestionIdx(prev => (prev < clientSuggestions.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setClientSuggestionIdx(prev => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      let selected = clientSuggestions[0]
      if (clientSuggestionIdx >= 0 && clientSuggestionIdx < clientSuggestions.length) {
        selected = clientSuggestions[clientSuggestionIdx]
      }
      setClientName(selected.name)
      if (selected.mobile && !clientMobile) setClientMobile(selected.mobile)
      setShowClientSuggestions(false)
    }
  }

  function handleSiteKeyDown(e) {
    if (!showSiteSuggestions || siteSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSiteSuggestionIdx(prev => (prev < siteSuggestions.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSiteSuggestionIdx(prev => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      let selected = siteSuggestions[0]
      if (siteSuggestionIdx >= 0 && siteSuggestionIdx < siteSuggestions.length) {
        selected = siteSuggestions[siteSuggestionIdx]
      }
      setSiteName(selected.site_name)
      setShowSiteSuggestions(false)
    }
  }

  // ── Global Keyboard Shortcuts ──
  useEffect(() => {
    function handleGlobalHotkeys(e) {
      // Ctrl+S or Cmd+S -> Save Estimate
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleGenerate()
      }
      // F2 -> Focus Product Search Input
      if (e.key === 'F2') {
        e.preventDefault()
        productInputRef.current?.focus()
      }
      // Escape -> Close active modals / suggestions
      if (e.key === 'Escape') {
        setShowItemModal(false)
        setShowProductModal(false)
        setShowSuggestions(false)
        setShowClientSuggestions(false)
        setShowSiteSuggestions(false)
      }
    }
    window.addEventListener('keydown', handleGlobalHotkeys)
    return () => window.removeEventListener('keydown', handleGlobalHotkeys)
  }, [clientName, preparedBy, items, siteName, showItemModal, showProductModal])

  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveItem(false) // Changed to Add Next Item instead of closing
    }
  }

  // ── Item form field change ──
  function handleItemChange(e) {
    const { name, value } = e.target
    setItemForm(f => {
      const next = { ...f, [name]: value }
      if (name === 'discount_percent') {
        const disc = parseFloat(value) || 0
        const base = parseFloat(next.base_rate) || parseFloat(next.rate) || 0
        const calcRate = disc > 0 ? +(base * (1 - disc / 100)).toFixed(2) : base
        next.rate = calcRate
      }
      const { quantity, amount } = calcItem(next)
      if (next.calculation_type_snapshot === 'SQFT') {
        next.quantity = quantity
      } else if (next.calculation_type_snapshot === 'INCH' || next.calculation_type_snapshot === 'FEET') {
        next.quantity = parseFloat(next.nos) || 0
      }
      next.amount = amount
      return next
    })
  }

  // ── Open item modal ──
  function openAddProductModal() {
    setProductForm(EMPTY_PRODUCT_FORM)
    setShowProductCustomUnit(false)
    setShowProductModal(true)
  }

  function openAddItem() {
    setItemForm(EMPTY_ITEM)
    setBulkAddMode(false)
    setBulkSelectedItems([])
    setProductSearch('')
    setEditingItemIdx(null)
    setShowItemModal(true)
    setTimeout(() => productInputRef.current?.focus(), 100)
  }

  function openEditItem(idx) {
    const it = items[idx]
    const p = allProducts.find(prod => prod.id === it.product_id)
    const baseRate = p ? (parseFloat(p.rate) || parseFloat(it.rate)) : parseFloat(it.rate)
    const discPercent = it.discount_percent !== undefined && it.discount_percent !== '' ? it.discount_percent : 0
    setItemForm({
      ...it,
      base_rate: baseRate,
      discount_percent: discPercent ? String(discPercent) : '',
      has_stock: p ? p.has_stock : (it.has_stock || false),
      stock: p ? p.stock : (it.stock || 0),
      has_remark: p ? p.has_remark : (it.has_remark || false),
      has_discount: p ? p.has_discount : (Boolean(discPercent) || false),
      keyword_snapshot: p ? (p.keyword || '') : ''
    })
    setProductSearch(it.product_name_snapshot)
    setEditingItemIdx(idx)
    setShowItemModal(true)
  }

  // ── Create New Product ──
  function handleProductFormChange(e) {
    const { name, value, type, checked } = e.target
    const val = type === 'checkbox' ? checked : value
    setProductForm(f => {
      const next = { ...f, [name]: val }
      if (name === 'unit') next.calculation_type = value === 'Sq.Ft' ? 'SQFT' : 'QUANTITY'
      if (name === 'calculation_type' && value === 'QUANTITY') { next.length = ''; next.width = '' }
      return next
    })
  }

  function validateProduct() {
    if (!productForm.product_name.trim()) return 'Product name is required'
    if (!productForm.unit.trim()) return 'Unit is required'
    if (productForm.rate === '' || productForm.rate === null || productForm.rate === undefined || isNaN(productForm.rate) || Number(productForm.rate) < 0) return 'Valid rate is required'
    if (productForm.calculation_type === 'SQFT' || productForm.calculation_type === 'INCH' || productForm.calculation_type === 'FEET') {
      if (!productForm.length || isNaN(productForm.length)) return 'Length is required'
      if (!productForm.width || isNaN(productForm.width)) return 'Width is required'
    }
    if (productForm.has_stock) {
      if (productForm.stock === '' || isNaN(productForm.stock)) return 'Valid stock amount is required'
    }
    return null
  }

  async function handleProductSave() {
    const err = validateProduct()
    if (err) { showToast(err, 'error'); return }
    setSavingProduct(true)
    const isDimensionBased = productForm.calculation_type === 'SQFT' || productForm.calculation_type === 'INCH' || productForm.calculation_type === 'FEET'
    const payload = {
      product_name: productForm.product_name.trim().toUpperCase(),
      unit: productForm.unit.trim(), rate: Number(productForm.rate),
      calculation_type: productForm.calculation_type,
      length: isDimensionBased && productForm.length ? Number(productForm.length) : null,
      width: isDimensionBased && productForm.width ? Number(productForm.width) : null,
      has_stock: productForm.has_stock,
      stock: productForm.has_stock ? Number(productForm.stock) : 0,
      min_stock: productForm.has_stock ? Number(productForm.min_stock || 5) : 5,
      has_remark: productForm.has_remark,
      has_discount: productForm.has_discount,
      keyword: productForm.keyword ? productForm.keyword.trim() : null,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase.from('products').insert(payload).select().single()
    setSavingProduct(false)
    if (error) { showToast('Save failed: ' + error.message, 'error'); return }

    if (payload.has_stock) {
      await supabase.from('stock_history').insert({
        product_id: data.id,
        change_type: 'MANUAL_ADJUST',
        quantity_changed: payload.stock
      })
    }

    showToast('Product added ✓')
    setAllProducts(prev => {
      const next = [...prev, data]
      next.sort((a, b) => a.product_name.localeCompare(b.product_name))
      return next
    })
    setShowProductModal(false)
    selectProduct(data)
  }

  // ── Save item ──
  function saveItem(closeModal = true) {
    if (!itemForm.product_name_snapshot) { showToast('Select a product', 'error'); return }
    const rate = parseFloat(itemForm.rate)
    if (isNaN(rate) || rate < 0 || itemForm.rate === '') { showToast('Enter a valid rate', 'error'); return }

    const isPieceBased = itemForm.calculation_type_snapshot === 'SQFT' || itemForm.calculation_type_snapshot === 'INCH' || itemForm.calculation_type_snapshot === 'FEET'

    if (isPieceBased) {
      if (!itemForm.nos || parseFloat(itemForm.nos) <= 0) {
        showToast('Enter number of pieces (Nos)', 'error'); return
      }
    } else {
      if (!itemForm.quantity || parseFloat(itemForm.quantity) <= 0) {
        showToast('Enter quantity', 'error'); return
      }
    }

    // Stock limit validation check
    if (itemForm.has_stock) {
      const availStock = Number(itemForm.stock || 0)
      const requestedQty = isPieceBased ? (parseFloat(itemForm.nos) || 0) : (parseFloat(itemForm.quantity) || 0)

      const otherItemsQty = items
        .filter((_, idx) => idx !== editingItemIdx)
        .filter(it => it.product_id === itemForm.product_id)
        .reduce((sum, it) => {
          const itPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET'
          return sum + (itPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0))
        }, 0)

      const totalRequested = otherItemsQty + requestedQty
      if (totalRequested > availStock) {
        const unit = itemForm.unit_snapshot || 'units'
        if (otherItemsQty > 0) {
          showToast(`Cannot add! ${itemForm.product_name_snapshot} has ${availStock} ${unit} stock (${otherItemsQty} already added to this bill).`, 'error')
        } else {
          showToast(`Cannot add! ${itemForm.product_name_snapshot} has only ${availStock} ${unit} available in stock.`, 'error')
        }
        return
      }
    }

    const { quantity, amount } = calcItem(itemForm)
    const finalItem = {
      ...itemForm,
      quantity: isPieceBased ? (itemForm.calculation_type_snapshot === 'SQFT' ? quantity : parseFloat(itemForm.nos)) : parseFloat(itemForm.quantity),
      amount
    }

    setItems(prev => {
      const next = [...prev]
      if (editingItemIdx !== null) {
        next[editingItemIdx] = finalItem
      } else {
        next.push(finalItem)
      }
      return next
    })
    
    if (closeModal) {
      setShowItemModal(false)
    } else {
      setItemForm(EMPTY_ITEM)
      setProductSearch('')
      setEditingItemIdx(null)
      setTimeout(() => productInputRef.current?.focus(), 100)
    }
  }

  function saveBulkItems() {
    if (bulkSelectedItems.length === 0) return

    for (let i = 0; i < bulkSelectedItems.length; i++) {
      const item = bulkSelectedItems[i]
      const rate = parseFloat(item.rate)
      if (isNaN(rate) || rate < 0 || item.rate === '') {
        showToast(`Product "${item.product_name_snapshot}" has an invalid rate`, 'error')
        return
      }

      const isPieceBased = item.calculation_type_snapshot === 'SQFT' || item.calculation_type_snapshot === 'INCH' || item.calculation_type_snapshot === 'FEET'
      if (isPieceBased) {
        if (!item.nos || parseFloat(item.nos) <= 0) {
          showToast(`Enter valid Nos. for "${item.product_name_snapshot}"`, 'error')
          return
        }
      } else {
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          showToast(`Enter valid Quantity for "${item.product_name_snapshot}"`, 'error')
          return
        }
      }

      if (item.has_stock) {
        const availStock = Number(item.stock || 0)
        const requestedQty = isPieceBased ? (parseFloat(item.nos) || 0) : (parseFloat(item.quantity) || 0)

        const otherItemsQty = items
          .filter(it => it.product_id === item.product_id)
          .reduce((sum, it) => {
            const itPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET'
            return sum + (itPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0))
          }, 0)

        const totalRequested = otherItemsQty + requestedQty
        if (totalRequested > availStock) {
          const unit = item.unit_snapshot || 'units'
          if (otherItemsQty > 0) {
            showToast(`Cannot add! ${item.product_name_snapshot} has ${availStock} ${unit} stock (${otherItemsQty} already added to this bill).`, 'error')
          } else {
            showToast(`Cannot add! ${item.product_name_snapshot} has only ${availStock} ${unit} available in stock.`, 'error')
          }
          return
        }
      }
    }

    const itemsToAdd = bulkSelectedItems.map(item => {
      const isPieceBased = item.calculation_type_snapshot === 'SQFT' || item.calculation_type_snapshot === 'INCH' || item.calculation_type_snapshot === 'FEET'
      const { quantity, amount } = calcItem(item)
      return {
        ...item,
        quantity: isPieceBased ? (item.calculation_type_snapshot === 'SQFT' ? quantity : parseFloat(item.nos)) : parseFloat(item.quantity),
        amount
      }
    })

    setItems(prev => [...prev, ...itemsToAdd])
    setShowItemModal(false)
    showToast(`Added ${itemsToAdd.length} item(s) ✓`)
  }

  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Generate / Save Estimate ──
  async function handleGenerate() {
    if (!clientName.trim()) { showToast('Enter a Client Name (mandatory)', 'error'); return }
    if (!preparedBy.trim()) { showToast('Enter Prepared By name (mandatory)', 'error'); return }
    if (items.length === 0) { showToast('Add at least one product', 'error'); return }
    setSaving(true)
    try {
      const t = calcTotals(items, parseFloat(gstPercent) || 0)

      // Resolve client_id
      let finalClientId = null;
      if (clientName.trim()) {
        const cName = clientName.trim().toUpperCase()
        const found = allClients.find(c => c.name === cName)
        if (found) {
          finalClientId = found.id
        }
      }

      if (isEdit) {
        // UPDATE existing estimate
        const { error: estErr } = await supabase.from('estimates').update({
          bill_date: billDate,
          transport: clientName.trim().toUpperCase(),
          client_name: clientName.trim().toUpperCase(),
          client_mobile: clientMobile.trim(),
          order_by: orderBy.trim().toUpperCase(),
          client_id: finalClientId,
          prepared_by: preparedBy.trim().toUpperCase(),
          site_name: siteName.trim().toUpperCase() || null,
          type: docType,
          total_nos: t.total_nos,
          total_quantity: t.total_quantity,
          sub_total: t.sub_total,
          gst_percent: t.gst_percent,
          gst_amount: t.gst_amount,
          grand_total: t.grand_total,
          previous_balance: Number(previousBalance) || 0,
          updated_at: new Date().toISOString()
        }).eq('id', id)
        if (estErr) throw estErr

        // delete old items, reinsert
        await supabase.from('estimate_items').delete().eq('estimate_id', id)
        const newItems = items.map((it, i) => ({
          estimate_id: id,
          serial_number: i + 1,
          product_id: it.product_id,
          product_name_snapshot: it.product_name_snapshot,
          length_snapshot: it.length_snapshot,
          width_snapshot: it.width_snapshot,
          nos: parseFloat(it.nos) || null,
          quantity: parseFloat(it.quantity) || null,
          unit_snapshot: it.unit_snapshot,
          rate: parseFloat(it.rate),
          discount_percent: parseFloat(it.discount_percent) || 0,
          calculation_type_snapshot: it.calculation_type_snapshot,
          amount: it.amount,
          remark: it.remark ? it.remark.trim() : null
        }))
        const { error: itemErr } = await supabase.from('estimate_items').insert(newItems)
        if (itemErr) throw itemErr

        // Calculate and apply stock adjustments ONLY if ESTIMATE or RETURN
        if (docType === 'ESTIMATE' || docType === 'RETURN') {
          const isReturn = docType === 'RETURN';
          const netUsage = {}
          for (const it of items) {
            const qty = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET' ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
            netUsage[it.product_id] = (netUsage[it.product_id] || 0) + qty
          }
          const origUsage = {}
          if (isEdit) {
            for (const oi of originalItems) {
              const qty = oi.calculation_type_snapshot === 'SQFT' || oi.calculation_type_snapshot === 'INCH' || oi.calculation_type_snapshot === 'FEET' ? (parseFloat(oi.nos) || 0) : (parseFloat(oi.quantity) || 0)
              origUsage[oi.product_id] = (origUsage[oi.product_id] || 0) + qty
            }
          }
          for (const p of allProducts) {
            if (p.has_stock) {
              const curr = netUsage[p.id] || 0
              const orig = origUsage[p.id] || 0
              const diff = curr - orig
              if (diff !== 0) {
                const { data: pdata } = await supabase.from('products').select('stock').eq('id', p.id).single()
                if (pdata) {
                  const stockDelta = isReturn ? diff : -diff;
                  const newStock = Number(pdata.stock) + stockDelta
                  await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
                  await supabase.from('stock_history').insert({
                    product_id: p.id,
                    change_type: isEdit ? (isReturn ? 'RETURN_UPDATE' : 'ESTIMATE_UPDATE') : (isReturn ? 'RETURN_ADD' : 'ESTIMATE_DEDUCT'),
                    quantity_changed: stockDelta,
                    estimate_id: id,
                    bill_number: existingBillNumber?.toString(),
                    site_name: siteName
                  })
                }
              }
            }
          }
        }

        // --- NEW LOGIC: Record Partywise Stock History ---
        if ((docType === 'ESTIMATE' || docType === 'RETURN') && finalClientId && existingBillNumber) {
          const isReturn = docType === 'RETURN';
          const purchaseRecords = items.map(it => {
            const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
            const qty = isPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0);
            return {
              client_id: finalClientId,
              product_id: it.product_id || null,
              product_name: it.product_name_snapshot || 'Manual Item',
              quantity: isReturn ? -qty : qty,
              unit: isPieceBased ? 'Nos.' : (it.unit_snapshot || ''),
              rate: Number(it.rate) || 0,
              amount: isReturn ? -Number(it.amount) : (Number(it.amount) || 0),
              bill_number: existingBillNumber,
              bill_date: billDate
            };
          }).filter(r => r.quantity !== 0 || r.amount !== 0);

          if (purchaseRecords.length > 0) {
            await supabase.from('client_purchases').delete().eq('bill_number', existingBillNumber);
            await supabase.from('client_purchases').insert(purchaseRecords);
          }
        }

        // save site if new
        await saveSite(siteName.trim().toUpperCase())
        localStorage.removeItem(draftKey) // clear draft on success
        showToast(`${docType === 'QUOTATION' ? 'Quotation' : 'Estimate'} updated ✓`)
        navigate(`/estimate/view/${id}`)

      } else {
        // CREATE new estimate — get atomic bill number
        const { data: seqData, error: seqErr } = await supabase
          .rpc('get_next_bill_number')
        if (seqErr) throw seqErr
        const billNumber = seqData

        const { data: est, error: estErr } = await supabase.from('estimates').insert({
          bill_number: billNumber,
          bill_date: billDate,
          transport: clientName.trim().toUpperCase(),
          client_name: clientName.trim().toUpperCase(),
          client_mobile: clientMobile.trim(),
          order_by: orderBy.trim().toUpperCase(),
          client_id: finalClientId,
          prepared_by: preparedBy.trim().toUpperCase(),
          site_name: siteName.trim().toUpperCase(),
          type: docType,
          total_nos: t.total_nos,
          total_quantity: t.total_quantity,
          sub_total: t.sub_total,
          gst_percent: t.gst_percent,
          gst_amount: t.gst_amount,
          grand_total: t.grand_total,
          previous_balance: Number(previousBalance) || 0
        }).select().single()
        if (estErr) throw estErr

        const newItems = items.map((it, i) => ({
          estimate_id: est.id,
          serial_number: i + 1,
          product_id: it.product_id,
          product_name_snapshot: it.product_name_snapshot,
          length_snapshot: it.length_snapshot,
          width_snapshot: it.width_snapshot,
          nos: parseFloat(it.nos) || null,
          quantity: parseFloat(it.quantity) || null,
          unit_snapshot: it.unit_snapshot,
          rate: parseFloat(it.rate),
          discount_percent: parseFloat(it.discount_percent) || 0,
          calculation_type_snapshot: it.calculation_type_snapshot,
          amount: it.amount,
          remark: it.remark ? it.remark.trim() : null
        }))
        const { error: itemErr } = await supabase.from('estimate_items').insert(newItems)
        if (itemErr) throw itemErr

        // Calculate and apply stock adjustments ONLY if ESTIMATE
        if (docType === 'ESTIMATE' || docType === 'RETURN') {
          const isReturn = docType === 'RETURN';
          const netUsage = {}
          for (const it of items) {
            const qty = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET' ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0)
            netUsage[it.product_id] = (netUsage[it.product_id] || 0) + qty
          }
          for (const p of allProducts) {
            if (p.has_stock) {
              const curr = netUsage[p.id] || 0
              if (curr !== 0) {
                const { data: pdata } = await supabase.from('products').select('stock').eq('id', p.id).single()
                if (pdata) {
                  const stockDelta = isReturn ? curr : -curr;
                  const newStock = Number(pdata.stock) + stockDelta
                  await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
                  await supabase.from('stock_history').insert({
                    product_id: p.id,
                    change_type: isReturn ? 'RETURN_ADD' : 'ESTIMATE_DEDUCT',
                    quantity_changed: stockDelta,
                    estimate_id: est.id,
                    bill_number: billNumber?.toString(),
                    site_name: siteName
                  })
                }
              }
            }
          }
        }

        // --- NEW LOGIC: Record Partywise Stock History ---
        if ((docType === 'ESTIMATE' || docType === 'RETURN') && finalClientId) {
          const isReturn = docType === 'RETURN';
          const purchaseRecords = items.map(it => {
            const isPieceBased = it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET';
            const qty = isPieceBased ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0);
            return {
              client_id: finalClientId,
              product_id: it.product_id || null,
              product_name: it.product_name_snapshot || 'Manual Item',
              quantity: isReturn ? -qty : qty,
              unit: isPieceBased ? 'Nos.' : (it.unit_snapshot || ''),
              rate: Number(it.rate) || 0,
              amount: isReturn ? -Number(it.amount) : (Number(it.amount) || 0),
              bill_number: billNumber,
              bill_date: billDate
            };
          }).filter(r => r.quantity !== 0 || r.amount !== 0);

          if (purchaseRecords.length > 0) {
            await supabase.from('client_purchases').delete().eq('bill_number', billNumber);
            await supabase.from('client_purchases').insert(purchaseRecords);
          }
        }

        await saveSite(siteName.trim().toUpperCase())
        localStorage.removeItem(draftKey) // clear draft on success
        showToast(`${docType === 'QUOTATION' ? 'Quotation' : docType === 'RETURN' ? 'Sales Return' : 'Estimate'} saved ✓`)
        navigate(`/estimate/view/${est.id}`)
      }
    } catch (err) {
      showToast('Save failed: ' + (err.message || err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function saveSite(name) {
    const exists = allSites.find(s => s.site_name.toLowerCase() === name.toLowerCase())
    if (!exists) {
      await supabase.from('sites').insert({ site_name: name })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)}>←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">{isEdit ? 'Edit Estimate' : 'New Estimate'}</span>
      </div>
      <div className="spinner" />
    </div>
  )

  return (
    <div className="app-container">
      <div className="top-nav">
        <button className="nav-back" onClick={() => navigate(-1)}>←</button>
        <button className="nav-home" onClick={() => navigate('/')} title="Home">🏠</button>
        <span className="nav-title">
          {isEdit
            ? `Edit ${docType === 'QUOTATION' ? 'Quotation' : 'Estimate'} #${existingBillNumber}`
            : `New ${docType === 'QUOTATION' ? 'Quotation' : 'Estimate'}`}
        </span>
      </div>

      <div className="page">

        {/* Unsaved draft banner */}
        {isDraftRestored && (
          <div style={{
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--accent, #3b82f6)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
              <span style={{ fontSize: 16 }}>📝</span>
              <span>Restored unsaved draft</span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={handleDiscardDraft}
              style={{ fontSize: 13, padding: '6px 12px', flexShrink: 0 }}
            >
              🗑️ Discard Draft
            </button>
          </div>
        )}

        {/* Bill info */}
        <div className="card">
          {!isEdit && (
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Document Type</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${docType === 'QUOTATION' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDocType('QUOTATION')}
                  style={{ flex: 1 }}
                >
                  📜 Quotation
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${docType === 'ESTIMATE' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDocType('ESTIMATE')}
                  style={{ flex: 1 }}
                >
                  📄 Estimate
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${docType === 'RETURN' ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => setDocType('RETURN')}
                  style={{ flex: 1, background: docType === 'RETURN' ? '#dc2626' : undefined, color: docType === 'RETURN' ? '#fff' : undefined }}
                >
                  ↩️ Return
                </button>
              </div>
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label>Bill No.</label>
              <input readOnly value={isEdit ? existingBillNumber : '(Auto)'} />
            </div>
            <div className="field">
              <label>Date</label>
              <input type="text" value={billDate}
                onChange={e => setBillDate(e.target.value)}
                readOnly={true} 
                disabled={isEdit}
                style={isEdit ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Client Name *</label>
              <div className="autocomplete-wrap">
                <input
                  ref={clientInputRef}
                  value={clientName}
                  onChange={e => {
                    const val = e.target.value.toUpperCase()
                    setClientName(val)
                    const found = allClients.find(c => c.name.toUpperCase() === val.trim())
                    if (found && found.mobile && !clientMobile) setClientMobile(found.mobile)
                    setShowClientSuggestions(true)
                  }}
                  onKeyDown={handleClientKeyDown}
                  onFocus={() => clientName && setShowClientSuggestions(clientSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
                  placeholder="Client name (mandatory)"
                  style={{ textTransform: 'uppercase' }}
                />
                {showClientSuggestions && (
                  <div className="autocomplete-list">
                    {clientSuggestions.map((s, idx) => (
                      <div key={idx} className="autocomplete-item"
                        ref={(el) => {
                          if (clientSuggestionIdx === idx && el) {
                            el.scrollIntoView({ block: 'nearest' })
                          }
                        }}
                        style={clientSuggestionIdx === idx ? { background: 'var(--bg)', borderLeft: '3px solid var(--accent)' } : {}}
                        onMouseDown={() => {
                          setClientName(s.name)
                          if (s.mobile && !clientMobile) setClientMobile(s.mobile)
                          setShowClientSuggestions(false)
                          if (!isEdit && s.id) fetchClientCurrentBalance(s.id)
                        }}>
                        {s.name} {s.mobile ? `(${s.mobile})` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="field">
              <label>Mobile (M.)</label>
              <input type="tel" value={clientMobile} onChange={e => setClientMobile(e.target.value)}
                placeholder="Mobile number (optional)" />
            </div>
            
            <div className="field">
              <label>Order By</label>
              <input type="text" value={orderBy} onChange={e => setOrderBy(e.target.value)}
                placeholder="Order by (optional)" style={{ textTransform: 'uppercase' }} />
            </div>
          </div>

          <div className="field">
            <label>Prepared By *</label>
            <input value={preparedBy} onChange={e => setPreparedBy(e.target.value)}
              placeholder="Enter name (mandatory)" style={{ textTransform: 'uppercase' }} />
          </div>

          {/* Site name with autocomplete */}
          <div className="field">
            <label>Site Name</label>
            <div className="autocomplete-wrap">
              <input
                ref={siteInputRef}
                value={siteName}
                onChange={e => { setSiteName(e.target.value); setShowSiteSuggestions(true) }}
                onKeyDown={handleSiteKeyDown}
                onFocus={() => siteName && setShowSiteSuggestions(siteSuggestions.length > 0)}
                onBlur={() => setTimeout(() => setShowSiteSuggestions(false), 200)}
                placeholder=""
                style={{ textTransform: 'uppercase' }}
              />
              {showSiteSuggestions && (
                <div className="autocomplete-list">
                  {siteSuggestions.map((s, idx) => (
                    <div key={s.id || idx} className="autocomplete-item"
                      ref={(el) => {
                        if (siteSuggestionIdx === idx && el) {
                          el.scrollIntoView({ block: 'nearest' })
                        }
                      }}
                      style={siteSuggestionIdx === idx ? { background: 'var(--bg)', borderLeft: '3px solid var(--accent)' } : {}}
                      onMouseDown={() => { setSiteName(s.site_name); setShowSiteSuggestions(false) }}>
                      {s.site_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Items */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 24 }}>
          <span className="section-label" style={{ margin: 0 }}>{items.length} Item{items.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary btn-sm" onClick={openAddItem}>+ ADD ITEM</button>
        </div>

        {items.length === 0 ? (
          <div className="empty-state" style={{ padding: '28px 20px' }}>
            <div className="empty-icon">📋</div>
            <p>No items yet. Tap + ADD ITEM to begin.</p>
          </div>
        ) : items.map((it, idx) => (
          <div key={idx} className="item-card">
            <div className="item-name">
              {idx + 1}. {it.product_name_snapshot}{it.remark ? ` - ${it.remark}` : ''}
            </div>
            <div className="item-grid">
              {it.calculation_type_snapshot === 'SQFT' ? (
                <>
                  <div><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>NOS</span><br />{it.nos}</div>
                  <div><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>QTY</span><br />{it.quantity} {it.unit_snapshot}</div>
                </>
              ) : (
                <div><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>QTY</span><br />{it.quantity} {it.unit_snapshot}</div>
              )}
              <div><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>RATE</span><br />₹{Number(it.rate).toFixed(2)}</div>
            </div>
            <div className="item-amount">₹{Number(calcItem(it).amount || it.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            <div className="item-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => openEditItem(idx)}>✏️ Edit</button>
              <button className="btn btn-danger btn-sm" onClick={() => removeItem(idx)}>🗑 Remove</button>
            </div>
          </div>
        ))}

        {/* Totals */}
        {items.length > 0 && (
          <div className="totals-bar">
            <div className="total-row">
              <span>Total Nos.</span>
              <span>{totals.total_nos}</span>
            </div>
            <div className="total-row">
              <span>Total Quantity</span>
              <span>{totals.total_quantity}</span>
            </div>
            <div className="total-row" style={{ marginTop: 12, alignItems: 'flex-start' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                GST (%) 
                <input
                  type="number"
                  inputMode="decimal"
                  value={gstPercent}
                  onChange={e => setGstPercent(e.target.value)}
                  placeholder="0"
                  style={{ width: 60, padding: '4px 8px', fontSize: 14 }}
                />
              </span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Sub Total: ₹{totals.sub_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                {totals.gst_percent > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Add GST ({totals.gst_percent}%): ₹{totals.gst_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                )}
              </div>
            </div>
            <div className="total-row grand">
              <span>Gr. Total</span>
              <span>₹{totals.grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="total-row" style={{ marginTop: 12, alignItems: 'center', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Prev. Balance (Frozen)
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 4 }}>Locked at generation</div>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                ₹ <input
                  type="number"
                  inputMode="decimal"
                  value={previousBalance}
                  onChange={e => setPreviousBalance(e.target.value)}
                  placeholder="0.00"
                  style={{ width: 90, padding: '6px 8px', fontSize: 14, textAlign: 'right' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky generate button */}
      <div className="sticky-bottom">
        <div className="sticky-bottom-inner">
          <button className="btn btn-secondary" onClick={() => navigate(-1)}
            style={{ flexShrink: 0 }}>Cancel</button>
          <button className="btn btn-primary btn-full btn-lg"
            onClick={handleGenerate} disabled={saving}>
            {saving
              ? 'Saving...'
              : isEdit
                ? '💾 SAVE CHANGES'
                : (docType === 'QUOTATION' ? '📜 GENERATE QUOTATION' : docType === 'RETURN' ? '↩️ GENERATE SALES RETURN' : '📄 GENERATE ESTIMATE')}
          </button>
        </div>
      </div>

      {/* ── Item Add/Edit Modal ── */}
      {showItemModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowItemModal(false)}>
          <div className="modal-box">
            <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {editingItemIdx !== null ? 'Edit Item' : 'Add Item'}
                {editingItemIdx === null && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>
                    <input
                      type="checkbox"
                      checked={bulkAddMode}
                      onChange={e => {
                        setBulkAddMode(e.target.checked)
                        setProductSearch('')
                        setProductSuggestions([])
                        setSuggestionIdx(-1)
                      }}
                      style={{ margin: 0 }}
                    />
                    {bulkAddMode && bulkSelectedItems.length > 0 ? `Select Multiple (${bulkSelectedItems.length} selected)` : 'Select Multiple'}
                  </label>
                )}
                {bulkAddMode && bulkSelectedItems.length > 0 && (
                  <button 
                    className="btn btn-ghost btn-sm" 
                    style={{ color: 'var(--danger)', padding: '2px 8px', fontSize: 12, marginLeft: 4 }} 
                    onClick={() => setBulkSelectedItems([])}
                  >
                    Clear
                  </button>
                )}
                {bulkAddMode && showSuggestions && (
                  <button 
                    type="button"
                    className="btn btn-primary btn-sm" 
                    style={{ padding: '2px 12px', fontSize: 12, marginLeft: 8 }} 
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setShowSuggestions(false)
                      setProductSearch('')
                    }}
                  >
                    Done
                  </button>
                )}
              </span>
              <button className="btn btn-ghost" onClick={() => setShowItemModal(false)}>✕</button>
            </div>

            {/* Product search */}
            <div className="field">
              <label>Product *</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <div className="autocomplete-wrap" style={{ flex: 1 }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      ref={productInputRef}
                      value={productSearch}
                      onChange={e => { setProductSearch(e.target.value); setShowSuggestions(true) }}
                      onKeyDown={handleProductKeyDown}
                      onFocus={() => setShowSuggestions(productSuggestions.length > 0)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      placeholder="Type or tap mic to search..."
                      autoComplete="off"
                      style={{ paddingRight: 40 }}
                    />
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${isListening ? 'listening pulse-mic' : ''}`}
                      style={{ position: 'absolute', right: 4, padding: '4px 8px', color: isListening ? 'var(--danger-color)' : 'var(--text-muted)' }}
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
                  {showSuggestions && productSuggestions.length > 0 && (
                    <div className="autocomplete-list">
                      {productSuggestions.map((p, i) => (
                        <div key={p.id} className="autocomplete-item"
                          ref={(el) => {
                            if (suggestionIdx === i && el) {
                              el.scrollIntoView({ block: 'nearest' })
                            }
                          }}
                          style={suggestionIdx === i ? { background: 'var(--bg)', borderLeft: '3px solid var(--accent)' } : {}}
                          onMouseDown={(e) => {
                            if (bulkAddMode) e.preventDefault();
                            selectProduct(p);
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {bulkAddMode && (
                              <input 
                                type="checkbox" 
                                readOnly 
                                checked={bulkSelectedItems.some(it => it.product_id === p.id)} 
                                style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} 
                              />
                            )}
                            <div>
                              <div style={{ fontWeight: 600 }}>{p.product_name}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {p.unit} · ₹{p.rate} · {p.calculation_type}
                                {(p.calculation_type === 'SQFT' || p.calculation_type === 'INCH' || p.calculation_type === 'FEET') && ` · ${p.length}×${p.width} ${p.calculation_type === 'INCH' || p.calculation_type === 'FEET' ? (p.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}`}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" className="btn btn-secondary" style={{ padding: '0 12px', height: '42px', flexShrink: 0 }} onClick={() => {
                  setProductForm({ ...EMPTY_PRODUCT_FORM, product_name: productSearch })
                  setShowProductModal(true)
                }}>+ New</button>
              </div>
            </div>

            {!bulkAddMode ? (
              <>
                {/* Show selected product details */}
                {itemForm.product_name_snapshot && (
                  <div style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
                    <strong>{itemForm.product_name_snapshot}</strong><br />
                    {itemForm.unit_snapshot} · {itemForm.calculation_type_snapshot}
                    {Boolean(itemForm.length_snapshot && itemForm.width_snapshot) &&
                      ` · ${itemForm.length_snapshot} × ${itemForm.width_snapshot} ${itemForm.calculation_type_snapshot === 'INCH' || itemForm.calculation_type_snapshot === 'FEET' ? (itemForm.calculation_type_snapshot === 'FEET' ? 'ft' : 'in') : 'ft'}`}
                    {itemForm.has_stock && (
                      <div style={{ marginTop: 4, color: itemForm.stock > 0 ? 'var(--primary-color)' : 'var(--danger-color)', fontWeight: 600 }}>
                        Available Stock: {itemForm.stock} {itemForm.unit_snapshot}
                      </div>
                    )}
                  </div>
                )}

                {itemForm.keyword_snapshot && (
                  <div style={{ background: '#fff3cd', color: '#856404', border: '1px solid #ffeeba', borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontSize: 13, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase' }}>
                    {itemForm.keyword_snapshot}
                  </div>
                )}

                {/* Nos (SQFT and INCH/FEET) */}
                {(itemForm.calculation_type_snapshot === 'SQFT' || itemForm.calculation_type_snapshot === 'INCH' || itemForm.calculation_type_snapshot === 'FEET') && (
                  <div className="field">
                    <label>Nos. (Number of Pieces / Units) *</label>
                    <input name="nos" type="number" inputMode="decimal"
                      ref={nosInputRef}
                      value={itemForm.nos} onChange={handleItemChange}
                      onKeyDown={handleInputKeyDown}
                      placeholder="e.g. 10" autoFocus={false} />
                    {itemForm.nos && itemForm.length_snapshot && itemForm.width_snapshot && (
                      <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                        {itemForm.calculation_type_snapshot === 'SQFT' ? (
                          `${itemForm.length_snapshot} × ${itemForm.width_snapshot} × ${itemForm.nos} = ${(itemForm.length_snapshot * itemForm.width_snapshot * (parseFloat(itemForm.nos) || 0)).toFixed(2)} Sq.Ft`
                        ) : (
                          `${itemForm.length_snapshot} × ${itemForm.width_snapshot} × ${itemForm.nos} × ₹${itemForm.rate} = ₹${Math.ceil(itemForm.length_snapshot * itemForm.width_snapshot * (parseFloat(itemForm.nos) || 0) * (parseFloat(itemForm.rate) || 0)).toLocaleString('en-IN')} (Qty: ${itemForm.nos} ${itemForm.unit_snapshot})`
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Quantity (QUANTITY type) */}
                {itemForm.calculation_type_snapshot === 'QUANTITY' && (
                  <div className="field">
                    <label>Quantity ({itemForm.unit_snapshot || 'units'}) *</label>
                    <input name="quantity" type="number" inputMode="decimal"
                      ref={qtyInputRef}
                      value={itemForm.quantity} onChange={handleItemChange}
                      onKeyDown={handleInputKeyDown}
                      placeholder="e.g. 5" />
                  </div>
                )}

                {/* Discount (%) field */}
                {(itemForm.has_discount || Boolean(parseFloat(itemForm.discount_percent))) && (
                  <div className="field">
                    <label>Discount (%)</label>
                    <input name="discount_percent" type="number" inputMode="decimal"
                      value={itemForm.discount_percent || ''} onChange={handleItemChange}
                      onKeyDown={handleInputKeyDown}
                      placeholder="e.g. 10" />
                    {itemForm.base_rate > 0 && parseFloat(itemForm.discount_percent) > 0 && (
                      <div style={{ fontSize: 13, color: 'var(--primary-color)', marginTop: 4, fontWeight: 600 }}>
                        Master Rate: ₹{Number(itemForm.base_rate).toFixed(2)} − {itemForm.discount_percent}% = Rate: ₹{Number(itemForm.rate).toFixed(2)}
                      </div>
                    )}
                  </div>
                )}

                {/* Rate */}
                <div className="field">
                  <label>Rate (₹) *</label>
                  <input name="rate" type="number" inputMode="decimal"
                    value={itemForm.rate} onChange={handleItemChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder="0.00"
                    disabled={itemForm.has_discount || Boolean(parseFloat(itemForm.discount_percent))}
                    title={(itemForm.has_discount || Boolean(parseFloat(itemForm.discount_percent))) ? "Rate is read-only for discounted products. Edit in Product Master." : ""}
                  />
                </div>

                {/* Remark (shown if enabled for product or already set) */}
                {(itemForm.has_remark || Boolean(itemForm.remark)) && (
                  <div className="field">
                    <label>Remark / Extra Note (Optional)</label>
                    <input name="remark" value={itemForm.remark || ''} onChange={handleItemChange}
                      onKeyDown={handleInputKeyDown}
                      placeholder="e.g. Soft Close, Gloss Finish (optional)" />
                  </div>
                )}

                {/* Calculated amount preview */}
                {itemForm.amount > 0 && (
                  <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 700, color: 'var(--accent)', marginBottom: 16 }}>
                    Amount: ₹{Number(itemForm.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-secondary btn-full" onClick={() => setShowItemModal(false)}>Cancel</button>
                  <button className="btn btn-primary btn-full" style={{ background: '#f59e0b', color: '#fff', border: 'none' }} onClick={() => saveItem(false)}>
                    Add Next
                  </button>
                  <button className="btn btn-primary btn-full" onClick={() => saveItem(true)}>
                    {editingItemIdx !== null ? 'Update Item' : 'Add Item'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontWeight: 600, margin: 0 }}>Selected Products ({bulkSelectedItems.length})</label>
                </div>
                {bulkSelectedItems.length === 0 ? (
                  <div className="empty-state" style={{ padding: '16px', fontSize: 13 }}>
                    No products selected yet. Search and select above.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '300px', overflowY: 'auto', paddingRight: 4, marginBottom: 16 }}>
                    {bulkSelectedItems.map((item, idx) => {
                      const isPieceBased = item.calculation_type_snapshot === 'SQFT' || item.calculation_type_snapshot === 'INCH' || item.calculation_type_snapshot === 'FEET'
                      return (
                        <div key={idx} style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                              <strong style={{ display: 'block', fontSize: 13 }}>
                                {item.product_name_snapshot}
                              </strong>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                                ₹{item.rate} · {item.unit_snapshot}
                                {Boolean(item.length_snapshot && item.width_snapshot) && ` · ${item.length_snapshot}×${item.width_snapshot}`}
                                {item.has_stock && ` (Stock: ${item.stock})`}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ color: 'var(--danger)', fontSize: 16, padding: '0 4px', marginTop: -4 }}
                              onClick={() => {
                                setBulkSelectedItems(prev => prev.filter((_, i) => i !== idx))
                              }}
                            >
                              ✕
                            </button>
                          </div>
                          
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 80 }}>
                                <label style={{ fontSize: 10, display: 'block', color: 'var(--text-muted)', marginBottom: 2 }}>
                                  {isPieceBased ? 'Nos.' : 'Qty'}
                                </label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 13, height: '30px', border: '1px solid var(--border-light)', borderRadius: 4, boxSizing: 'border-box' }}
                                  value={isPieceBased ? item.nos : item.quantity}
                                  onChange={e => {
                                    const val = e.target.value
                                    setBulkSelectedItems(prev => {
                                      const next = [...prev]
                                      const target = { ...next[idx] }
                                      if (isPieceBased) {
                                        target.nos = val
                                      } else {
                                        target.quantity = val
                                      }
                                      const { quantity, amount } = calcItem(target)
                                      target.quantity = quantity || ''
                                      target.amount = amount
                                      next[idx] = target
                                      return next
                                    })
                                  }}
                                  placeholder="1"
                                />
                              </div>
                              <div style={{ width: 90 }}>
                                <label style={{ fontSize: 10, display: 'block', color: 'var(--text-muted)', marginBottom: 2 }}>
                                  Rate (₹)
                                </label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  style={{ width: '100%', padding: '4px 6px', fontSize: 13, height: '30px', border: '1px solid var(--border-light)', borderRadius: 4, boxSizing: 'border-box' }}
                                  value={item.rate}
                                  disabled={item.has_discount || Boolean(parseFloat(item.discount_percent))}
                                  onChange={e => {
                                    const val = e.target.value
                                    setBulkSelectedItems(prev => {
                                      const next = [...prev]
                                      const target = { ...next[idx], rate: val }
                                      const { quantity, amount } = calcItem(target)
                                      target.quantity = quantity || ''
                                      target.amount = amount
                                      next[idx] = target
                                      return next
                                    })
                                  }}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            
                            {item.amount > 0 && (
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', alignSelf: 'flex-end', marginBottom: 4 }}>
                                ₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                
                <div style={{ display: 'flex', gap: 10, position: 'sticky', bottom: -24, background: 'white', padding: '16px 0 0 0', borderTop: '1px solid #eee', marginTop: 16, zIndex: 20 }}>
                  <button className="btn btn-secondary btn-full" style={{ flex: 1 }} onClick={() => setShowItemModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary btn-full"
                    style={{ flex: 1 }}
                    onClick={saveBulkItems}
                    disabled={bulkSelectedItems.length === 0}
                  >
                    Add Selected ({bulkSelectedItems.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create Product Modal ── */}
      {showProductModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowProductModal(false)} style={{ zIndex: 1100 }}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Add New Product</span>
              <button className="btn btn-ghost" onClick={() => setShowProductModal(false)}>✕</button>
            </div>
            <div className="field">
              <label>Product Name *</label>
              <input name="product_name" value={productForm.product_name} onChange={handleProductFormChange}
                placeholder="e.g. C PLY 4 18 MM 7 x 4" style={{ textTransform: 'uppercase' }} autoFocus />
            </div>
            <div className="field">
              <label>Highlight Keyword (Optional)</label>
              <input name="keyword" value={productForm.keyword || ''} onChange={handleProductFormChange}
                placeholder="e.g. PLYWOOD or SPECIAL OFFER" />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Unit *</label>
                {!showProductCustomUnit ? (
                  <select name="unit" value={productForm.unit} onChange={e => {
                    if (e.target.value === 'ADD_CUSTOM') {
                      setShowProductCustomUnit(true)
                      setProductForm(f => ({ ...f, unit: '' }))
                    } else {
                      handleProductFormChange(e)
                    }
                  }}>
                    <option value="">Select unit</option>
                    {getMergedUnits(allProducts).map(u => <option key={u} value={u}>{u}</option>)}
                    <option value="ADD_CUSTOM">➕ Add Custom Unit...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input name="unit" value={productForm.unit} onChange={handleProductFormChange}
                      placeholder="Type custom unit (e.g. Sheet, Gram, Dozen)" autoFocus />
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowProductCustomUnit(false)}>✕</button>
                  </div>
                )}
              </div>
              <div className="field">
                <label>Calculation Type *</label>
                <select name="calculation_type" value={productForm.calculation_type} onChange={handleProductFormChange}>
                  <option value="QUANTITY">QUANTITY</option>
                  <option value="SQFT">SQFT</option>
                  <option value="INCH">INCH</option>
                  <option value="FEET">FEET</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Rate (₹) *</label>
              <input name="rate" type="number" inputMode="decimal"
                value={productForm.rate} onChange={handleProductFormChange} placeholder="0.00" />
            </div>
            {(productForm.calculation_type === 'SQFT' || productForm.calculation_type === 'INCH' || productForm.calculation_type === 'FEET') && (
              <div className="field-row">
                <div className="field">
                  <label>Length ({productForm.calculation_type === 'INCH' || productForm.calculation_type === 'FEET' ? (productForm.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}) *</label>
                  <input name="length" type="number" inputMode="decimal"
                    value={productForm.length} onChange={handleProductFormChange} placeholder="e.g. 12" />
                </div>
                <div className="field">
                  <label>Width ({productForm.calculation_type === 'INCH' || productForm.calculation_type === 'FEET' ? (productForm.calculation_type === 'FEET' ? 'ft' : 'in') : 'ft'}) *</label>
                  <input name="width" type="number" inputMode="decimal"
                    value={productForm.width} onChange={handleProductFormChange} placeholder="e.g. 8" />
                </div>
              </div>
            )}
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_stock" checked={!!productForm.has_stock} onChange={handleProductFormChange} style={{ width: 16, height: 16 }} />
                Manage Stock for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_remark" checked={!!productForm.has_remark} onChange={handleProductFormChange} style={{ width: 16, height: 16 }} />
                Ask Remark / Extra Note for this product
              </label>
            </div>
            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                <input type="checkbox" name="has_discount" checked={!!productForm.has_discount} onChange={handleProductFormChange} style={{ width: 16, height: 16 }} />
                Allow Discount for this product
              </label>
            </div>
            {productForm.has_stock && (
              <div className="field">
                <label>Current Stock *</label>
                <input name="stock" type="number" inputMode="decimal"
                  value={productForm.stock} onChange={handleProductFormChange} placeholder="e.g. 100" />
                <div style={{ marginTop: 12 }}>
                  <label>Minimum Stock Level * (Reorder Alert Limit)</label>
                  <input name="min_stock" type="number" inputMode="decimal"
                    value={productForm.min_stock} onChange={handleProductFormChange} placeholder="e.g. 5" />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Alert is triggered when stock falls below this quantity
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn btn-secondary btn-full" onClick={() => setShowProductModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleProductSave} disabled={savingProduct}>
                {savingProduct ? 'Saving...' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ToastEl}
    </div>
  )
}
