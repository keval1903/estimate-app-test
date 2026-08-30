export async function generateExcelWorkbook(supabase) {
  try {
    const XLSX = await import('xlsx')

    // 1. Fetch Clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true })

    // 2. Fetch Payments (table: 'payments')
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .order('payment_date', { ascending: false })

    // 3. Fetch Estimates & Returns
    const { data: estimates } = await supabase
      .from('estimates')
      .select('*')
      .order('bill_number', { ascending: false })

    const clientMap = new Map((clients || []).map(c => [c.id, c.name]))

    // Build Sheet 1: Client Ledger Balances
    const clientRows = (clients || []).map(c => {
      const openingBal = Number(c.opening_balance || 0)
      const openingDebit = openingBal > 0 ? openingBal : 0
      const openingCredit = openingBal < 0 ? Math.abs(openingBal) : 0

      const clientEsts = (estimates || []).filter(e => String(e.client_id) === String(c.id) && !e.is_archived)
      const estTotal = clientEsts
        .filter(e => e.type === 'ESTIMATE' || e.type === 'DELETED_ESTIMATE')
        .reduce((sum, e) => sum + (Number(e.grand_total) || 0), 0)

      const returnTotal = clientEsts
        .filter(e => e.type === 'RETURN' || e.type === 'DELETED_RETURN')
        .reduce((sum, e) => sum + (Number(e.grand_total) || 0), 0)

      const clientPayments = (payments || []).filter(p => String(p.client_id) === String(c.id) && !p.is_archived)
      const payTotal = clientPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

      const totalDebit = openingDebit + estTotal
      const totalCredit = openingCredit + returnTotal + payTotal
      const netBalance = totalDebit - totalCredit

      let status = 'Clear'
      if (netBalance > 0) status = 'Dr (Due)'
      if (netBalance < 0) status = 'Cr (Advance)'

      return {
        'Client Name': c.name || 'Unnamed',
        'Mobile': c.mobile || '-',
        'Opening Balance': openingBal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        'Total Bills / Debit (₹)': totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        'Total Paid / Credit (₹)': totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        'Net Outstanding Balance (₹)': Math.abs(netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        'Status': status
      }
    })

    // Build Sheet 2: Estimates, Quotations & Returns
    const estimateRows = (estimates || []).map(e => ({
      'Bill No': e.bill_number,
      'Type': e.type || 'ESTIMATE',
      'Date': e.bill_date || '-',
      'Client': e.client_name || e.transport || clientMap.get(e.client_id) || 'Cash',
      'Site': e.site_name || '-',
      'Sub Total (₹)': Number(e.sub_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'GST Amount (₹)': Number(e.gst_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Grand Total (₹)': Number(e.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Prep By': e.prepared_by || '-'
    }))

    // Build Sheet 3: Payments Log
    const paymentRows = (payments || []).map(p => ({
      'Date': p.payment_date || '-',
      'Client Name': clientMap.get(p.client_id) || 'Unknown Client',
      'Amount (₹)': Number(p.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      'Payment Mode': p.payment_mode || 'CASH',
      'Description / Ref': p.description || '-'
    }))

    const wb = XLSX.utils.book_new()
    
    const wsClients = XLSX.utils.json_to_sheet(clientRows.length > 0 ? clientRows : [{ 'Info': 'No clients found' }])
    const wsEstimates = XLSX.utils.json_to_sheet(estimateRows.length > 0 ? estimateRows : [{ 'Info': 'No estimates found' }])
    const wsPayments = XLSX.utils.json_to_sheet(paymentRows.length > 0 ? paymentRows : [{ 'Info': 'No payments found' }])

    XLSX.utils.book_append_sheet(wb, wsClients, 'Client Balances')
    XLSX.utils.book_append_sheet(wb, wsEstimates, 'Estimates & Quotes')
    XLSX.utils.book_append_sheet(wb, wsPayments, 'Payment History')

    return wb
  } catch (err) {
    console.error('Failed to generate Excel workbook:', err)
    throw err
  }
}

export async function downloadExcelBackup(supabase) {
  const XLSX = await import('xlsx')
  const wb = await generateExcelWorkbook(supabase)
  const dateStr = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `Ledger_Backup_${dateStr}.xlsx`)
}
