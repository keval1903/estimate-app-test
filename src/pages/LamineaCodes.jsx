import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../hooks/useToast.jsx'
import { normalizeSearchQuery as normalizeText } from '../lib/synonyms'
import { isFuzzyMatch as isSubsequence } from '../lib/searchUtils'
import * as XLSX from 'xlsx'

const normalizeAltCode = (val) => String(val || '').replace(/\s+/g, '').toUpperCase()

export default function LamineaCodes() {
  const { user } = useAuth()
  const { showToast, ToastEl } = useToast()

  const [codes, setCodes] = useState([])
  const [groups, setGroups] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  // Tabs: 'all' (All Codes) | 'groups' (Groups)
  const [activeTab, setActiveTab] = useState('all')
  const [selectedGroupId, setSelectedGroupId] = useState(null)

  // Filters for All Codes tab
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Filters for Group detail view
  const [groupDetailSearch, setGroupDetailSearch] = useState('')

  // Single Code Add/Edit Modal
  const [showModal, setShowModal] = useState(false)
  const [editingCode, setEditingCode] = useState(null)
  const [formData, setFormData] = useState({
    group_id: '',
    alternative_code: '',
    product_id: '',
    is_active: true,
    reason: ''
  })

  // 5-Code Product Set Modal (Configure 5 base alternative codes for a product in a group)
  const [showFiveCodeModal, setShowFiveCodeModal] = useState(false)
  const [fiveCodeForm, setFiveCodeForm] = useState({
    group_id: '',
    product_id: '',
    slots: ['', '', '', '', ''],
    reason: ''
  })
  const [savingFiveCodes, setSavingFiveCodes] = useState(false)

  // Group Create/Edit Modal
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    is_active: true
  })
  const [savingGroup, setSavingGroup] = useState(false)

  // Product Autocomplete (shared helper for modals)
  const [prodSearch, setProdSearch] = useState('')
  const [prodDropdown, setProdDropdown] = useState(false)
  const [dropdownIdx, setDropdownIdx] = useState(-1)
  const prodWrapRef = useRef(null)

  // Import State
  const [showImportModal, setShowImportModal] = useState(false)
  const [importMode, setImportMode] = useState('merge')
  const [previewRows, setPreviewRows] = useState([])
  const [showPreviewModal, setShowPreviewModal] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (prodWrapRef.current && !prodWrapRef.current.contains(e.target)) {
        setProdDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const fetchAll = async (queryFn) => {
        const PAGE_SIZE = 1000
        let all = []
        let from = 0
        while (true) {
          const { data, error } = await queryFn().range(from, from + PAGE_SIZE - 1)
          if (error) throw error
          all = [...all, ...(data || [])]
          if (!data || data.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
        return all
      }

      const [groupsRes, allCodes, allProducts] = await Promise.all([
        supabase
          .from('laminea_code_groups')
          .select('*')
          .order('name', { ascending: true }),
        fetchAll(() =>
          supabase
            .from('laminea_product_codes')
            .select(`
              id,
              group_id,
              alternative_code,
              product_id,
              is_active,
              created_at,
              updated_at,
              products (
                id,
                product_code,
                product_name,
                stock
              ),
              laminea_code_groups (
                id,
                name,
                is_active
              )
            `)
            .order('alternative_code', { ascending: true })
        ),
        fetchAll(() =>
          supabase
            .from('products')
            .select('id, product_code, product_name, stock, in_laminea, has_stock')
            .eq('in_laminea', true)
            .eq('has_stock', true)
            .not('product_code', 'is', null)
            .neq('product_code', '')
            .order('product_name', { ascending: true })
        )
      ])

      if (groupsRes.error) throw groupsRes.error

      const loadedGroups = groupsRes.data || []
      setGroups(loadedGroups)
      setCodes(allCodes)
      setProducts(allProducts)
    } catch (err) {
      console.error(err)
      showToast('Failed to load alternative codes & groups', 'error')
    } finally {
      setLoading(false)
    }
  }

  const groupMap = useMemo(() => {
    const map = new Map()
    groups.forEach(g => map.set(g.id, g))
    return map
  }, [groups])

  // Detect any legacy products with > 5 active codes in a group
  const overlimitSummary = useMemo(() => {
    const counts = new Map()
    codes.forEach(c => {
      if (!c.is_active) return
      const key = `${c.group_id}::${c.product_id}`
      const prev = counts.get(key) || {
        group_id: c.group_id,
        group_name: groupMap.get(c.group_id)?.name || c.laminea_code_groups?.name || 'Unknown Group',
        product_id: c.product_id,
        product_code: c.products?.product_code || '',
        product_name: c.products?.product_name || '',
        count: 0
      }
      prev.count += 1
      counts.set(key, prev)
    })
    return Array.from(counts.values()).filter(item => item.count > 5)
  }, [codes, groupMap])

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim()
    if (!q) return products.slice(0, 50)
    const normQ = normalizeText(q)
    const rawWords = q.toLowerCase().split(/\s+/).filter(Boolean)
    const normWords = normQ.split(/\s+/).filter(Boolean)

    return products.filter(p => {
      const code = (p.product_code || '').toLowerCase()
      const rawName = (p.product_name || '').toLowerCase()
      const normName = normalizeText(p.product_name || '')
      return rawWords.every((rw, i) => {
        const nw = normWords[i] || rw
        return (
          code.includes(rw) ||
          rawName.includes(rw) ||
          normName.includes(nw) ||
          isSubsequence(rw, rawName) ||
          isSubsequence(nw, normName)
        )
      })
    }).slice(0, 50)
  }, [products, prodSearch])

  const filteredCodes = useMemo(() => {
    const q = search.trim()
    const normCodeSearch = normalizeAltCode(q)
    const normQ = normalizeText(q)
    const rawWords = q.toLowerCase().split(/\s+/).filter(Boolean)
    const normWords = normQ.split(/\s+/).filter(Boolean)

    return codes.filter(c => {
      if (groupFilter !== 'ALL' && c.group_id !== groupFilter) return false
      if (statusFilter === 'ACTIVE' && !c.is_active) return false
      if (statusFilter === 'INACTIVE' && c.is_active) return false

      if (!q) return true

      const normAlt = normalizeAltCode(c.alternative_code)
      if (normCodeSearch && normAlt.includes(normCodeSearch)) return true

      const pCode = (c.products?.product_code || '').toLowerCase()
      const rawPName = (c.products?.product_name || '').toLowerCase()
      const normPName = normalizeText(c.products?.product_name || '')
      const grpName = (groupMap.get(c.group_id)?.name || c.laminea_code_groups?.name || '').toLowerCase()

      return rawWords.every((rw, i) => {
        const nw = normWords[i] || rw
        return (
          normAlt.toLowerCase().includes(rw) ||
          pCode.includes(rw) ||
          grpName.includes(rw) ||
          rawPName.includes(rw) ||
          normPName.includes(nw) ||
          isSubsequence(rw, rawPName) ||
          isSubsequence(nw, normPName)
        )
      })
    })
  }, [codes, search, groupFilter, statusFilter, groupMap])

  // Group stats & products mapped inside the selected group
  const groupStats = useMemo(() => {
    const map = new Map()
    groups.forEach(g => {
      map.set(g.id, {
        ...g,
        activeCodeCount: 0,
        totalCodeCount: 0,
        productIds: new Set()
      })
    })
    codes.forEach(c => {
      const entry = map.get(c.group_id)
      if (!entry) return
      entry.totalCodeCount += 1
      if (c.is_active) {
        entry.activeCodeCount += 1
        entry.productIds.add(c.product_id)
      }
    })
    return Array.from(map.values()).map(g => ({
      ...g,
      productCount: g.productIds.size
    }))
  }, [groups, codes])

  const selectedGroup = useMemo(
    () => groups.find(g => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  )

  const selectedGroupProductRows = useMemo(() => {
    if (!selectedGroupId) return []
    const byProduct = new Map()

    codes
      .filter(c => c.group_id === selectedGroupId)
      .forEach(c => {
        const pid = c.product_id
        if (!byProduct.has(pid)) {
          byProduct.set(pid, {
            product_id: pid,
            product_code: c.products?.product_code || '—',
            product_name: c.products?.product_name || 'Unknown Product',
            stock: c.products?.stock ?? 0,
            mappings: []
          })
        }
        byProduct.get(pid).mappings.push(c)
      })

    let list = Array.from(byProduct.values()).map(row => {
      row.mappings.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
        return a.alternative_code.localeCompare(b.alternative_code)
      })
      return row
    })

    list.sort((a, b) => a.product_name.localeCompare(b.product_name))

    const q = groupDetailSearch.trim()
    if (!q) return list

    const normCodeQ = normalizeAltCode(q)
    const lowerQ = q.toLowerCase()
    return list.filter(row => {
      if (row.product_code.toLowerCase().includes(lowerQ)) return true
      if (row.product_name.toLowerCase().includes(lowerQ)) return true
      return row.mappings.some(m => normalizeAltCode(m.alternative_code).includes(normCodeQ))
    })
  }, [codes, selectedGroupId, groupDetailSearch])

  // Open Single Code Add/Edit Modal
  function openModal(codeObj = null, defaultGroupId = null) {
    const fallbackGroup = defaultGroupId
      || (groupFilter !== 'ALL' ? groupFilter : null)
      || selectedGroupId
      || (groups.find(g => g.is_active)?.id || groups[0]?.id || '')

    if (codeObj) {
      setEditingCode(codeObj)
      setFormData({
        group_id: codeObj.group_id,
        alternative_code: codeObj.alternative_code,
        product_id: codeObj.product_id,
        is_active: codeObj.is_active,
        reason: ''
      })
      const p = products.find(x => x.id === codeObj.product_id)
      setProdSearch(p ? `${p.product_code} - ${p.product_name}` : '')
    } else {
      setEditingCode(null)
      setFormData({
        group_id: fallbackGroup,
        alternative_code: '',
        product_id: '',
        is_active: true,
        reason: ''
      })
      setProdSearch('')
    }
    setDropdownIdx(-1)
    setShowModal(true)
  }

  // Open 5-Code Set Modal for a Product in a Group
  function openFiveCodeModal(groupId = null, productObj = null) {
    const targetGroupId = groupId
      || selectedGroupId
      || (groupFilter !== 'ALL' ? groupFilter : null)
      || (groups.find(g => g.is_active)?.id || groups[0]?.id || '')

    if (productObj) {
      const existingActive = codes
        .filter(c => c.group_id === targetGroupId && c.product_id === productObj.product_id && c.is_active)
        .map(c => c.alternative_code)
      const slots = [0, 1, 2, 3, 4].map(i => existingActive[i] || '')
      setFiveCodeForm({
        group_id: targetGroupId,
        product_id: productObj.product_id,
        slots,
        reason: ''
      })
      setProdSearch(`${productObj.product_code} - ${productObj.product_name}`)
    } else {
      setFiveCodeForm({
        group_id: targetGroupId,
        product_id: '',
        slots: ['', '', '', '', ''],
        reason: ''
      })
      setProdSearch('')
    }
    setDropdownIdx(-1)
    setShowFiveCodeModal(true)
  }

  function handleSelectProductForFiveCodes(p) {
    const existingActive = codes
      .filter(c => c.group_id === fiveCodeForm.group_id && c.product_id === p.id && c.is_active)
      .map(c => c.alternative_code)
    const slots = [0, 1, 2, 3, 4].map(i => existingActive[i] || '')
    setFiveCodeForm(prev => ({
      ...prev,
      product_id: p.id,
      slots
    }))
    setProdSearch(`${p.product_code} - ${p.product_name}`)
    setProdDropdown(false)
  }

  async function handleSaveFiveCodes(e) {
    e.preventDefault()
    if (!fiveCodeForm.group_id) {
      return showToast('Please select a group', 'error')
    }
    if (!fiveCodeForm.product_id) {
      return showToast('Please select a product from the list', 'error')
    }

    const cleanedSlots = fiveCodeForm.slots
      .map(s => s.trim().toUpperCase().replace(/\s+/g, ' '))
      .filter(Boolean)

    // Check duplicate normalized codes within the 5 slots
    const seenNorm = new Set()
    for (const s of cleanedSlots) {
      const norm = normalizeAltCode(s)
      if (seenNorm.has(norm)) {
        return showToast(`Duplicate base code "${s}" in slots`, 'error')
      }
      seenNorm.add(norm)
    }

    setSavingFiveCodes(true)
    try {
      const { error } = await supabase.rpc('save_group_product_codes', {
        p_group_id: fiveCodeForm.group_id,
        p_product_id: fiveCodeForm.product_id,
        p_codes: cleanedSlots,
        p_reason: fiveCodeForm.reason.trim() || 'Configured product base codes in group'
      })
      if (error) throw error

      showToast('Saved group product base codes', 'success')
      setShowFiveCodeModal(false)
      await fetchData()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Failed to save product base codes', 'error')
    } finally {
      setSavingFiveCodes(false)
    }
  }

  function openGroupModal(groupObj = null) {
    if (groupObj) {
      setEditingGroup(groupObj)
      setGroupForm({
        name: groupObj.name,
        description: groupObj.description || '',
        is_active: groupObj.is_active
      })
    } else {
      setEditingGroup(null)
      setGroupForm({
        name: '',
        description: '',
        is_active: true
      })
    }
    setShowGroupModal(true)
  }

  async function handleSaveGroup(e) {
    e.preventDefault()
    const cleanName = groupForm.name.trim().toUpperCase()
    if (!cleanName) {
      return showToast('Group name is required', 'error')
    }

    setSavingGroup(true)
    try {
      const { data, error } = await supabase.rpc('save_laminea_code_group', {
        p_group_id: editingGroup ? editingGroup.id : null,
        p_name: cleanName,
        p_description: groupForm.description.trim() || null,
        p_is_active: groupForm.is_active
      })
      if (error) throw error

      showToast(editingGroup ? 'Group updated' : 'Group created', 'success')
      setShowGroupModal(false)
      await fetchData()
      if (!editingGroup && data?.id) {
        setSelectedGroupId(data.id)
      }
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Failed to save group', 'error')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleToggleGroupActive(groupObj) {
    const nextStatus = !groupObj.is_active
    const actionLabel = nextStatus ? 'enable' : 'disable'
    if (!window.confirm(`Are you sure you want to ${actionLabel} group "${groupObj.name}"?`)) return

    try {
      const { error } = await supabase.rpc('save_laminea_code_group', {
        p_group_id: groupObj.id,
        p_name: groupObj.name,
        p_description: groupObj.description || null,
        p_is_active: nextStatus
      })
      if (error) throw error
      showToast(`Group "${groupObj.name}" ${nextStatus ? 'enabled' : 'disabled'}`, 'success')
      await fetchData()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Failed to update group status', 'error')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!formData.group_id) {
      return showToast('Please select a group', 'error')
    }
    if (!formData.product_id) {
      return showToast('Please select a valid product from the list', 'error')
    }
    const cleanAlt = formData.alternative_code.trim().toUpperCase().replace(/\s+/g, ' ')
    const normAlt = normalizeAltCode(cleanAlt)
    if (!normAlt) {
      return showToast('Alternative code cannot be empty', 'error')
    }

    // Check uniqueness within the selected group
    const duplicateInGroup = codes.find(
      c =>
        c.group_id === formData.group_id &&
        normalizeAltCode(c.alternative_code) === normAlt &&
        c.id !== editingCode?.id
    )
    if (duplicateInGroup) {
      return showToast(
        `Base code "${cleanAlt}" already exists in this group (mapped to ${duplicateInGroup.products?.product_code || 'a product'})`,
        'error'
      )
    }

    // Check 5-active-code limit per (group_id, product_id)
    if (formData.is_active) {
      const activeForProductInGroup = codes.filter(
        c =>
          c.group_id === formData.group_id &&
          c.product_id === formData.product_id &&
          c.is_active &&
          c.id !== editingCode?.id
      )
      if (activeForProductInGroup.length >= 5) {
        return showToast(
          'A product can have at most 5 active base alternative codes in a single group.',
          'error'
        )
      }
    }

    try {
      if (editingCode) {
        const isReassigned = editingCode.product_id !== formData.product_id
        const isDisabled = editingCode.is_active && !formData.is_active
        const isReactivated = !editingCode.is_active && formData.is_active

        if ((isReassigned || isDisabled) && !formData.reason.trim()) {
          return showToast('Please provide a reason for reassigning or disabling this code', 'error')
        }

        const { error: updErr } = await supabase
          .from('laminea_product_codes')
          .update({
            group_id: formData.group_id,
            alternative_code: cleanAlt,
            product_id: formData.product_id,
            is_active: formData.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingCode.id)

        if (updErr) throw updErr

        let action = null
        if (isReassigned) action = 'REASSIGNED'
        else if (isDisabled) action = 'DISABLED'
        else if (isReactivated) action = 'REACTIVATED'

        if (action) {
          await supabase
            .from('laminea_code_audit')
            .update({ reason: formData.reason.trim() || 'Updated via UI' })
            .eq('alternative_code', cleanAlt)
            .eq('group_id', formData.group_id)
            .is('reason', null)
        }

        showToast('Alternative code updated', 'success')
      } else {
        const { error: insErr } = await supabase
          .from('laminea_product_codes')
          .insert({
            group_id: formData.group_id,
            alternative_code: cleanAlt,
            product_id: formData.product_id,
            is_active: formData.is_active,
            created_by: user.id
          })

        if (insErr) throw insErr

        if (formData.reason.trim()) {
          await supabase
            .from('laminea_code_audit')
            .update({ reason: formData.reason.trim() })
            .eq('alternative_code', cleanAlt)
            .eq('group_id', formData.group_id)
            .is('reason', null)
        }

        showToast('Alternative code created', 'success')
      }

      setShowModal(false)
      await fetchData()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Error saving alternative code', 'error')
    }
  }

  async function handleToggleActive(codeObj) {
    const newStatus = !codeObj.is_active
    let reason = 'Status toggled'
    if (!newStatus) {
      reason = window.prompt('Please provide a reason for disabling this code:')
      if (reason === null) return
      if (!reason.trim()) {
        return showToast('A reason is required to disable a code', 'error')
      }
    } else {
      // Check 5-active-code limit before reactivating
      const activeCount = codes.filter(
        c =>
          c.group_id === codeObj.group_id &&
          c.product_id === codeObj.product_id &&
          c.is_active &&
          c.id !== codeObj.id
      ).length
      if (activeCount >= 5) {
        return showToast(
          'Cannot enable: this product already has 5 active base codes in this group.',
          'error'
        )
      }
    }

    try {
      const { error } = await supabase
        .from('laminea_product_codes')
        .update({ is_active: newStatus, updated_at: new Date().toISOString() })
        .eq('id', codeObj.id)

      if (error) throw error

      await supabase
        .from('laminea_code_audit')
        .update({ reason: reason.trim() })
        .eq('alternative_code', codeObj.alternative_code)
        .eq('group_id', codeObj.group_id)
        .is('reason', null)

      showToast(`Code ${newStatus ? 'enabled' : 'disabled'}`, 'success')
      await fetchData()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Error updating status', 'error')
    }
  }

  async function handleExport(targetGroupId = null) {
    try {
      const exportGroup = targetGroupId
        ? groupMap.get(targetGroupId)
        : groupFilter !== 'ALL'
        ? groupMap.get(groupFilter)
        : null

      const rowsToExport = targetGroupId
        ? codes.filter(c => c.group_id === targetGroupId)
        : filteredCodes

      const data = rowsToExport.map(c => ({
        Group: groupMap.get(c.group_id)?.name || c.laminea_code_groups?.name || '',
        AlternativeCode: c.alternative_code,
        ProductCode: c.products?.product_code || '',
        ProductName: c.products?.product_name || '',
        Status: c.is_active ? 'Active' : 'Inactive'
      }))

      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Alternative Codes')
      const suffix = exportGroup ? `_${exportGroup.name.replace(/\s+/g, '_')}` : ''
      XLSX.writeFile(wb, `Laminea_Base_Codes${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      console.error(err)
      showToast('Export failed', 'error')
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) throw new Error('No worksheet found')
      const sheet = workbook.Sheets[firstSheetName]
      const rawJson = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      if (!rawJson || rawJson.length === 0) throw new Error('No valid rows found')

      const firstRowKeys = Object.keys(rawJson[0] || {})
      const groupKey = firstRowKeys.find(k => {
        const clean = k.trim().toLowerCase()
        return (
          clean === 'group' ||
          clean === 'groupname' ||
          clean === 'group name' ||
          clean === 'codegroup' ||
          clean === 'code group' ||
          clean === 'alternativecodegroup' ||
          clean === 'alternative code group'
        )
      })
      const altKey = firstRowKeys.find(k => {
        const clean = k.trim().toLowerCase()
        return clean === 'alternativecode' || clean === 'alternative code'
      })
      const pCodeKey = firstRowKeys.find(k => {
        const clean = k.trim().toLowerCase()
        return clean === 'productcode' || clean === 'product code'
      })

      if (!groupKey || !altKey || !pCodeKey) {
        throw new Error('Columns "Group", "AlternativeCode", and "ProductCode" are required')
      }

      const rows = []
      for (const item of rawJson) {
        const rawGroup = String(item[groupKey] ?? '')
        const rawAlt = String(item[altKey] ?? '')
        const rawPCode = String(item[pCodeKey] ?? '')
        const groupName = rawGroup.trim().toUpperCase().replace(/\s+/g, ' ')
        const alt = rawAlt.trim().toUpperCase().replace(/\s+/g, ' ')
        const pCode = rawPCode.trim().toUpperCase()
        if (groupName || alt || pCode) {
          rows.push({ groupName, alt, pCode })
        }
      }

      if (rows.length === 0) throw new Error('No valid rows found')

      const existingGroupByNorm = new Map()
      groups.forEach(g => {
        if (g.name) existingGroupByNorm.set(normalizeAltCode(g.name), g)
      })

      const existingByGroupAndNorm = new Map()
      codes.forEach(c => {
        const gName = groupMap.get(c.group_id)?.name || c.laminea_code_groups?.name || ''
        const normGrp = normalizeAltCode(gName)
        if (normGrp) {
          existingByGroupAndNorm.set(`${normGrp}:${normalizeAltCode(c.alternative_code)}`, c)
        }
      })

      const productByCode = new Map()
      products.forEach(p => {
        if (p.product_code) productByCode.set(p.product_code.trim().toUpperCase(), p)
      })

      // Track active codes per (group, product) to validate the 5-code limit
      const activeNormsByGroupProduct = new Map()
      if (importMode !== 'replace') {
        codes.forEach(c => {
          if (!c.is_active) return
          const gName = groupMap.get(c.group_id)?.name || c.laminea_code_groups?.name || ''
          const normGrp = normalizeAltCode(gName)
          if (!normGrp) return
          const key = `${normGrp}:${c.product_id}`
          if (!activeNormsByGroupProduct.has(key)) {
            activeNormsByGroupProduct.set(key, new Set())
          }
          activeNormsByGroupProduct.get(key).add(normalizeAltCode(c.alternative_code))
        })
      }

      const preview = []
      const seenGroupNorms = new Set()

      for (const r of rows) {
        let action = 'UNKNOWN'
        let targetProduct = null
        const normGroup = normalizeAltCode(r.groupName)
        const normAlt = normalizeAltCode(r.alt)
        const existingGroup = normGroup ? existingGroupByNorm.get(normGroup) : null
        const isNewGroup = Boolean(normGroup && !existingGroup)
        const displayGroupName = existingGroup ? existingGroup.name : r.groupName
        const groupNormKey = `${normGroup}:${normAlt}`

        if (!r.groupName || !normGroup || !r.alt || !normAlt || !r.pCode) {
          action = 'MISSING DATA'
        } else if (seenGroupNorms.has(groupNormKey)) {
          action = 'DUPLICATE IN FILE'
        } else {
          seenGroupNorms.add(groupNormKey)
          targetProduct = productByCode.get(r.pCode)
          if (!targetProduct) {
            action = 'UNKNOWN PRODUCT'
          } else {
            const existing = existingByGroupAndNorm.get(groupNormKey)
            const gpKey = `${normGroup}:${targetProduct.id}`
            const prodSet = activeNormsByGroupProduct.get(gpKey) || new Set()

            if (!existing) {
              if (prodSet.size >= 5) {
                action = 'EXCEEDS 5 CODES FOR PRODUCT'
              } else {
                prodSet.add(normAlt)
                activeNormsByGroupProduct.set(gpKey, prodSet)
                action = 'NEW'
              }
            } else if (existing.product_id === targetProduct.id) {
              if (existing.is_active) {
                action = 'UNCHANGED'
              } else if (prodSet.size >= 5) {
                action = 'EXCEEDS 5 CODES FOR PRODUCT'
              } else {
                prodSet.add(normAlt)
                activeNormsByGroupProduct.set(gpKey, prodSet)
                action = 'REACTIVATE'
              }
            } else {
              action = 'CONFLICT'
            }
          }
        }

        preview.push({
          groupName: displayGroupName,
          isNewGroup,
          alternativeCode: r.alt,
          productCode: r.pCode,
          productId: targetProduct?.id || null,
          action
        })
      }

      setPreviewRows(preview)
      setShowImportModal(false)
      setShowPreviewModal(true)
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Import failed', 'error')
    }
    e.target.value = null
  }

  async function executeImport() {
    const blockingActions = [
      'CONFLICT',
      'UNKNOWN PRODUCT',
      'DUPLICATE IN FILE',
      'MISSING DATA',
      'EXCEEDS 5 CODES FOR PRODUCT'
    ]
    const hasErrors = previewRows.some(r => blockingActions.includes(r.action))
    if (hasErrors) {
      return showToast('Cannot import while there are conflicts or errors in the preview', 'error')
    }

    setLoading(true)
    try {
      const payload = previewRows.map(r => ({
        group: r.groupName,
        groupName: r.groupName,
        group_name: r.groupName,
        alternativeCode: r.alternativeCode,
        targetProductId: r.productId,
        alternative_code: r.alternativeCode,
        product_code: r.productCode
      }))

      const { data: importRes, error } = await supabase.rpc('import_laminea_alternative_codes', {
        rows: payload,
        mode: String(importMode || 'MERGE').toUpperCase(),
        actor_id: user.id,
        target_group_id: null
      })

      if (error) throw error

      const newGroupsCount = Number(importRes?.groups_created || 0)
      showToast(
        newGroupsCount > 0
          ? `Import completed (${newGroupsCount} new group${newGroupsCount > 1 ? 's' : ''} created)`
          : 'Import completed successfully',
        'success'
      )
      setShowPreviewModal(false)
      await fetchData()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Error executing import', 'error')
      setLoading(false)
    }
  }

  return (
    <div>
      {ToastEl}
      <div className="page" style={{ maxWidth: 1180 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Laminea Alternative Codes</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Manage reusable base alternative-code groups (up to 5 active base codes per product in a group). Customer prefixes are stored on customer accounts and never duplicated here.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setShowImportModal(true)}
            >
              Import Excel
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleExport(activeTab === 'groups' && selectedGroupId ? selectedGroupId : null)}
            >
              Export Excel
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => openFiveCodeModal(selectedGroupId || (groupFilter !== 'ALL' ? groupFilter : null))}
            >
              Configure 5 Product Codes
            </button>
            <button className="btn btn-primary" onClick={() => openModal(null, selectedGroupId)}>
              + Add Base Code
            </button>
          </div>
        </div>

        {/* Over-limit legacy diagnostic banner */}
        {overlimitSummary.length > 0 && (
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #f59e0b',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 13,
              color: '#92400e'
            }}
          >
            <strong>Legacy Over-Limit Notice:</strong> {overlimitSummary.length} product(s) currently have more than 5 active base codes preserved from legacy mappings:{' '}
            {overlimitSummary
              .slice(0, 5)
              .map(o => `${o.product_code} in ${o.group_name} (${o.count} active)`)
              .join(', ')}
            {overlimitSummary.length > 5 ? ` and ${overlimitSummary.length - 5} more.` : '.'}
          </div>
        )}

        {/* Primary Synchronized Tabs: All Codes vs Groups */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            borderBottom: '2px solid #e5e7eb',
            marginBottom: 20
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'all' ? '2px solid #111827' : '2px solid transparent',
              marginBottom: -2,
              fontWeight: activeTab === 'all' ? 700 : 500,
              color: activeTab === 'all' ? '#111827' : '#6b7280',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            All Codes ({codes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('groups')}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'groups' ? '2px solid #111827' : '2px solid transparent',
              marginBottom: -2,
              fontWeight: activeTab === 'groups' ? 700 : 500,
              color: activeTab === 'groups' ? '#111827' : '#6b7280',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            Groups ({groups.length})
          </button>
        </div>

        {/* ===================================================================
            TAB 1: ALL CODES (Base alternative codes with group identification)
           =================================================================== */}
        {activeTab === 'all' && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search Base Alternative Code (e.g. 01 SMT), Actual Product Code, Name, or Group..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 260,
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14
                }}
              />
              <select
                value={groupFilter}
                onChange={e => setGroupFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14,
                  background: '#fff'
                }}
              >
                <option value="ALL">All Groups</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name} {!g.is_active ? '(Inactive)' : ''}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14,
                  background: '#fff'
                }}
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>

            {loading ? (
              <div className="spinner-wrap">
                <div className="spinner" />
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Base Alternative Code</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Group</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Actual Product Code</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Product Name</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Live Stock</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Status</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCodes.length === 0 ? (
                        <tr>
                          <td colSpan="7" style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                            No base alternative codes found.
                          </td>
                        </tr>
                      ) : (
                        filteredCodes.map(c => {
                          const grp = groupMap.get(c.group_id) || c.laminea_code_groups
                          return (
                            <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '12px 16px', fontWeight: 700, color: '#111827', fontFamily: 'monospace', fontSize: 14 }}>
                                {c.alternative_code}
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedGroupId(c.group_id)
                                    setActiveTab('groups')
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '3px 10px',
                                    borderRadius: 9999,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: grp?.is_active === false ? '#f3f4f6' : '#eff6ff',
                                    color: grp?.is_active === false ? '#6b7280' : '#1d4ed8',
                                    border: '1px solid #bfdbfe',
                                    cursor: 'pointer'
                                  }}
                                  title="Open group mappings"
                                >
                                  {grp?.name || 'DEFAULT GROUP'}
                                </button>
                              </td>
                              <td style={{ padding: '12px 16px', color: '#4b5563', fontFamily: 'monospace' }}>
                                {c.products?.product_code || '—'}
                              </td>
                              <td style={{ padding: '12px 16px', color: '#111827' }}>
                                {c.products?.product_name || '—'}
                              </td>
                              <td style={{ padding: '12px 16px', fontWeight: 600, color: (c.products?.stock || 0) > 0 ? '#059669' : '#dc2626' }}>
                                {c.products?.stock ?? '—'}
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: 9999,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: c.is_active ? '#dcfce7' : '#fee2e2',
                                    color: c.is_active ? '#166534' : '#991b1b'
                                  }}
                                >
                                  {c.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => openModal(c)}
                                  style={{ marginRight: 6 }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleToggleActive(c)}
                                  style={{ color: c.is_active ? '#dc2626' : '#16a34a' }}
                                >
                                  {c.is_active ? 'Disable' : 'Enable'}
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===================================================================
            TAB 2: GROUPS (Group list + per-group products & base codes view)
           =================================================================== */}
        {activeTab === 'groups' && (
          <>
            {!selectedGroup ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 14, color: '#4b5563' }}>
                    Select a group to view or edit its product-to-base-code mappings, or create a new reusable group.
                  </div>
                  <button className="btn btn-primary" onClick={() => openGroupModal(null)}>
                    + Create Group
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
                  {groupStats.map(g => (
                    <div
                      key={g.id}
                      className="card"
                      style={{
                        padding: 18,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        border: g.is_active ? '1px solid #e5e7eb' : '1px dashed #d1d5db',
                        opacity: g.is_active ? 1 : 0.8
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <h3
                            style={{
                              margin: 0,
                              fontSize: 16,
                              fontWeight: 700,
                              color: '#111827',
                              cursor: 'pointer'
                            }}
                            onClick={() => setSelectedGroupId(g.id)}
                          >
                            {g.name}
                          </h3>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 600,
                              background: g.is_active ? '#dcfce7' : '#f3f4f6',
                              color: g.is_active ? '#166534' : '#6b7280'
                            }}
                          >
                            {g.is_active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </div>
                        {g.description && (
                          <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#6b7280' }}>{g.description}</p>
                        )}
                        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13, color: '#374151' }}>
                          <span>
                            <strong>{g.productCount}</strong> Products
                          </span>
                          <span>
                            <strong>{g.activeCodeCount}</strong> Active Base Codes
                          </span>
                          {g.totalCodeCount > g.activeCodeCount && (
                            <span style={{ color: '#6b7280' }}>
                              ({g.totalCodeCount - g.activeCodeCount} inactive)
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setSelectedGroupId(g.id)}
                        >
                          Open Group →
                        </button>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openGroupModal(g)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: g.is_active ? '#dc2626' : '#16a34a' }}
                            onClick={() => handleToggleGroupActive(g)}
                          >
                            {g.is_active ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                {/* Selected Group Header */}
                <div
                  className="card"
                  style={{
                    padding: 16,
                    marginBottom: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setSelectedGroupId(null)
                          setGroupDetailSearch('')
                        }}
                      >
                        ← All Groups
                      </button>
                      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selectedGroup.name}</h2>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: selectedGroup.is_active ? '#dcfce7' : '#f3f4f6',
                          color: selectedGroup.is_active ? '#166534' : '#6b7280'
                        }}
                      >
                        {selectedGroup.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>
                    {selectedGroup.description && (
                      <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#6b7280' }}>{selectedGroup.description}</p>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openGroupModal(selectedGroup)}
                    >
                      Edit Group Info
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openFiveCodeModal(selectedGroup.id, null)}
                    >
                      + Configure Product (5 Base Codes)
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => openModal(null, selectedGroup.id)}
                    >
                      + Add Single Base Code
                    </button>
                  </div>
                </div>

                {/* Search within selected group */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <input
                    type="text"
                    placeholder={`Search products or base codes in ${selectedGroup.name}...`}
                    value={groupDetailSearch}
                    onChange={e => setGroupDetailSearch(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 14
                    }}
                  />
                </div>

                {/* Products & their base alternative codes in this group */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Actual Product Code</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Product Name</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Live Stock</th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>
                            Base Alternative Codes (Up to 5 Active)
                          </th>
                          <th style={{ padding: '12px 16px', fontWeight: 600, color: '#374151', textAlign: 'right' }}>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGroupProductRows.length === 0 ? (
                          <tr>
                            <td colSpan="5" style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                              No product mappings in this group yet. Click &ldquo;+ Configure Product (5 Base Codes)&rdquo; to add one.
                            </td>
                          </tr>
                        ) : (
                          selectedGroupProductRows.map(row => {
                            const activeCount = row.mappings.filter(m => m.is_active).length
                            return (
                              <tr key={row.product_id} style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}>
                                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#374151' }}>
                                  {row.product_code}
                                </td>
                                <td style={{ padding: '12px 16px', color: '#111827', fontWeight: 500 }}>
                                  {row.product_name}
                                  <div style={{ fontSize: 11, color: activeCount > 5 ? '#b45309' : '#6b7280', marginTop: 2 }}>
                                    {activeCount}/5 active base codes
                                  </div>
                                </td>
                                <td style={{ padding: '12px 16px', fontWeight: 600, color: row.stock > 0 ? '#059669' : '#dc2626' }}>
                                  {row.stock}
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {row.mappings.map(m => (
                                      <span
                                        key={m.id}
                                        onClick={() => openModal(m)}
                                        title={m.is_active ? 'Click to edit base code' : 'Inactive — click to edit'}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          padding: '4px 10px',
                                          borderRadius: 6,
                                          fontFamily: 'monospace',
                                          fontSize: 13,
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          background: m.is_active ? '#f0fdf4' : '#f3f4f6',
                                          color: m.is_active ? '#166534' : '#9ca3af',
                                          border: m.is_active ? '1px solid #bbf7d0' : '1px dashed #d1d5db',
                                          textDecoration: m.is_active ? 'none' : 'line-through'
                                        }}
                                      >
                                        {m.alternative_code}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openFiveCodeModal(selectedGroup.id, row)}
                                  >
                                    Edit 5 Codes
                                  </button>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =====================================================================
          MODAL 1: Single Base Alternative Code Add / Edit
         ===================================================================== */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-box" style={{ overflow: 'visible' }}>
            <div className="modal-title">
              <span>{editingCode ? 'Edit Base Alternative Code' : 'Add Base Alternative Code'}</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Alternative-Code Group *</label>
                <select
                  value={formData.group_id}
                  onChange={e => setFormData({ ...formData, group_id: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14
                  }}
                >
                  <option value="">Select Group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} {!g.is_active ? '(Inactive)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Base Alternative Code * (Without customer prefix)</label>
                <input
                  type="text"
                  value={formData.alternative_code}
                  onChange={e => setFormData({ ...formData, alternative_code: e.target.value.toUpperCase() })}
                  placeholder="e.g. 01 SMT"
                  required
                />
                <span style={{ fontSize: 11, color: '#6b7280', marginTop: 4, display: 'block' }}>
                  Normalized comparison: &ldquo;01 SMT&rdquo; and &ldquo;01SMT&rdquo; resolve identically within this group.
                </span>
              </div>

              <div className="field" ref={prodWrapRef} style={{ position: 'relative' }}>
                <label>Actual Product Master Item *</label>
                <input
                  type="text"
                  value={prodSearch}
                  onChange={e => {
                    setProdSearch(e.target.value)
                    setFormData({ ...formData, product_id: '' })
                    setProdDropdown(true)
                    setDropdownIdx(-1)
                  }}
                  onFocus={() => setProdDropdown(true)}
                  onKeyDown={e => {
                    if (!prodDropdown || filteredProducts.length === 0) return
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setDropdownIdx(prev => (prev < filteredProducts.length - 1 ? prev + 1 : 0))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setDropdownIdx(prev => (prev > 0 ? prev - 1 : filteredProducts.length - 1))
                    } else if (e.key === 'Enter' && dropdownIdx >= 0) {
                      e.preventDefault()
                      const selected = filteredProducts[dropdownIdx]
                      if (selected) {
                        setFormData({ ...formData, product_id: selected.id })
                        setProdSearch(`${selected.product_code} - ${selected.product_name}`)
                        setProdDropdown(false)
                        setDropdownIdx(-1)
                      }
                    } else if (e.key === 'Escape') {
                      setProdDropdown(false)
                    }
                  }}
                  placeholder="Search actual product code or name..."
                  required
                />
                {prodDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      maxHeight: 200,
                      overflowY: 'auto',
                      zIndex: 50,
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                    }}
                  >
                    {filteredProducts.length === 0 ? (
                      <div style={{ padding: 8, color: '#6b7280', fontSize: 13 }}>No matching eligible products</div>
                    ) : (
                      filteredProducts.map((p, idx) => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setFormData({ ...formData, product_id: p.id })
                            setProdSearch(`${p.product_code} - ${p.product_name}`)
                            setProdDropdown(false)
                            setDropdownIdx(-1)
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f3f4f6',
                            fontSize: 13,
                            background:
                              idx === dropdownIdx
                                ? '#e5e7eb'
                                : formData.product_id === p.id
                                ? '#f3f4f6'
                                : 'transparent'
                          }}
                        >
                          <strong>{p.product_code}</strong> - {p.product_name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  <span>Active</span>
                </label>
              </div>

              <div className="field">
                <label>
                  Reason for Change{' '}
                  {editingCode &&
                  (editingCode.product_id !== formData.product_id ||
                    (editingCode.is_active && !formData.is_active))
                    ? '*'
                    : '(Optional)'}
                </label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={e => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Reason for creating, reassigning, or disabling..."
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-full">
                  Save Base Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: Configure 5 Base Alternative Codes for a Product in a Group
         ===================================================================== */}
      {showFiveCodeModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowFiveCodeModal(false)}>
          <div className="modal-box" style={{ maxWidth: 520, overflow: 'visible' }}>
            <div className="modal-title">
              <span>Configure 5 Base Codes for Product</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowFiveCodeModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveFiveCodes}>
              <div className="field">
                <label>Alternative-Code Group *</label>
                <select
                  value={fiveCodeForm.group_id}
                  onChange={e => {
                    const nextGroupId = e.target.value
                    const existingActive = codes
                      .filter(c => c.group_id === nextGroupId && c.product_id === fiveCodeForm.product_id && c.is_active)
                      .map(c => c.alternative_code)
                    setFiveCodeForm(prev => ({
                      ...prev,
                      group_id: nextGroupId,
                      slots: [0, 1, 2, 3, 4].map(i => existingActive[i] || '')
                    }))
                  }}
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14
                  }}
                >
                  <option value="">Select Group...</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} {!g.is_active ? '(Inactive)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" ref={prodWrapRef} style={{ position: 'relative' }}>
                <label>Actual Product Master Item *</label>
                <input
                  type="text"
                  value={prodSearch}
                  onChange={e => {
                    setProdSearch(e.target.value)
                    setFiveCodeForm(prev => ({ ...prev, product_id: '' }))
                    setProdDropdown(true)
                  }}
                  onFocus={() => setProdDropdown(true)}
                  placeholder="Search actual product code or name..."
                  required
                />
                {prodDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      maxHeight: 200,
                      overflowY: 'auto',
                      zIndex: 50,
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                    }}
                  >
                    {filteredProducts.length === 0 ? (
                      <div style={{ padding: 8, color: '#6b7280', fontSize: 13 }}>No matching eligible products</div>
                    ) : (
                      filteredProducts.map(p => (
                        <div
                          key={p.id}
                          onClick={() => handleSelectProductForFiveCodes(p)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f3f4f6',
                            fontSize: 13,
                            background: fiveCodeForm.product_id === p.id ? '#f3f4f6' : 'transparent'
                          }}
                        >
                          <strong>{p.product_code}</strong> - {p.product_name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="field">
                <label>Predefined Set of Up to 5 Base Alternative Codes</label>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
                  Enter base codes only (such as <code>01 SMT</code>). Leave unused slots blank.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {fiveCodeForm.slots.map((slotVal, idx) => (
                    <div key={idx}>
                      <label style={{ fontSize: 11, color: '#6b7280' }}>Base Code #{idx + 1}</label>
                      <input
                        type="text"
                        value={slotVal}
                        onChange={e => {
                          const next = [...fiveCodeForm.slots]
                          next[idx] = e.target.value.toUpperCase()
                          setFiveCodeForm(prev => ({ ...prev, slots: next }))
                        }}
                        placeholder={`Slot ${idx + 1} (e.g. 0${idx + 1} SMT)`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Reason / Audit Note (Optional)</label>
                <input
                  type="text"
                  value={fiveCodeForm.reason}
                  onChange={e => setFiveCodeForm(prev => ({ ...prev, reason: e.target.value }))}
                  placeholder="Reason for updating base codes..."
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={() => setShowFiveCodeModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-full" disabled={savingFiveCodes}>
                  {savingFiveCodes ? 'Saving...' : 'Save 5 Base Codes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: Create / Edit Alternative-Code Group
         ===================================================================== */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowGroupModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>{editingGroup ? 'Edit Alternative-Code Group' : 'Create Alternative-Code Group'}</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowGroupModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveGroup}>
              <div className="field">
                <label>Group Name *</label>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={e => setGroupForm({ ...groupForm, name: e.target.value.toUpperCase() })}
                  placeholder="e.g. GROUP A - RETAIL"
                  required
                />
              </div>
              <div className="field">
                <label>Description (Optional)</label>
                <input
                  type="text"
                  value={groupForm.description}
                  onChange={e => setGroupForm({ ...groupForm, description: e.target.value })}
                  placeholder="Notes about which customers share this group..."
                />
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={groupForm.is_active}
                    onChange={e => setGroupForm({ ...groupForm, is_active: e.target.checked })}
                  />
                  <span>Group Active (Disabling preserves all historical mappings)</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={() => setShowGroupModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-full" disabled={savingGroup}>
                  {savingGroup ? 'Saving...' : 'Save Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: Import Base Codes from Excel (Group resolved from Excel)
         ===================================================================== */}
      {showImportModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowImportModal(false)}>
          <div className="modal-box">
            <div className="modal-title">
              <span>Import Base Codes from Excel</span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowImportModal(false)}>
                ✕
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Excel file must contain columns: <strong>Group</strong>, <strong>AlternativeCode</strong> (base code without customer prefix), and <strong>ProductCode</strong>. Any group mentioned in the Excel file will be assigned automatically, or created if it is new.
            </p>

            <div className="field">
              <label>Import Mode</label>
              <select
                value={importMode}
                onChange={e => setImportMode(e.target.value)}
                style={{
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  width: '100%',
                  fontSize: '14px',
                  fontFamily: 'inherit'
                }}
              >
                <option value="merge">Merge Mode (Add/reactivate codes in each group and keep existing)</option>
                <option value="replace">Replace Mode (Deactivate codes in imported groups NOT in this file)</option>
              </select>
            </div>

            <div className="field" style={{ marginTop: 16 }}>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleImport}
                style={{ padding: '10px 0', border: 'none', fontSize: 14 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary btn-full"
                onClick={() => setShowImportModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: Import Preview
         ===================================================================== */}
      {showPreviewModal && (
        <div
          className="modal-overlay"
          style={{ padding: 20 }}
          onClick={e => e.target === e.currentTarget && setShowPreviewModal(false)}
        >
          <div
            className="modal-box"
            style={{
              maxWidth: 860,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div className="modal-title">
              <span>
                Import Preview ({previewRows.length} rows across{' '}
                {new Set(previewRows.map(r => r.groupName).filter(Boolean)).size} group(s))
              </span>
              <button className="btn btn-ghost" type="button" onClick={() => setShowPreviewModal(false)}>
                ✕
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginTop: 10,
                marginBottom: 16
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      Group
                    </th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      Base Alternative Code
                    </th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      Product Code
                    </th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    let color = '#374151'
                    if (r.action === 'NEW') color = '#16a34a'
                    else if (r.action === 'REACTIVATE') color = '#2563eb'
                    else if (
                      [
                        'CONFLICT',
                        'UNKNOWN PRODUCT',
                        'DUPLICATE IN FILE',
                        'MISSING DATA',
                        'EXCEEDS 5 CODES FOR PRODUCT'
                      ].includes(r.action)
                    ) {
                      color = '#dc2626'
                    }

                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>
                          {r.groupName ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span>{r.groupName}</span>
                              {r.isNewGroup && (
                                <span
                                  style={{
                                    padding: '1px 6px',
                                    borderRadius: 9999,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    background: '#dcfce7',
                                    color: '#166534'
                                  }}
                                >
                                  NEW GROUP
                                </span>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                          {r.alternativeCode || <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                          {r.productCode || <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px', color, fontWeight: 600 }}>{r.action}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowPreviewModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={executeImport}
                disabled={previewRows.some(r =>
                  [
                    'CONFLICT',
                    'UNKNOWN PRODUCT',
                    'DUPLICATE IN FILE',
                    'MISSING DATA',
                    'EXCEEDS 5 CODES FOR PRODUCT'
                  ].includes(r.action)
                )}
              >
                Execute Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
