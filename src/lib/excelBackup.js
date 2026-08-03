export async function generateExcelWorkbook(supabase) {
  try {
    const XLSX = await import('xlsx')
    // 1. Fetch Clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .order('name', { ascending: true })

    // 2. Fetch Payments
    const { data: payments } = await supabase
      .from('client_payments')
      .select('*')
      .order('payment_date', { ascending: false })

    // 3. Fetch Estimates
    const { data: estimates } = await supabase
      .from('estimates')
      .select('*')
      .order('bill_number', { ascending: false })

    // Build Sheet 1: Client Balances
    const clientRows = (clients || []).map(c => {
      const clientEstimates = (estimates || []).filter(e => String(e.client_id) === String(c.id) && e.type === 'ESTIMATE')
      const totalDebit = clientEstimates.reduce((sum, e) => sum + (Number(e.grand_total) || 0), 0) + (Number(c.opening_balance) || 0)
      
      const clientPayments = (payments || []).filter(p => String(p.client_id) === String(c.id))
      const totalCredit = clientPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)

      const netBalance = totalDebit - totalCredit
      const type = netBalance > 0 ? 'Dr (Due)' : (netBalance < 0 ? 'Cr (Advance)' : '0.00')

      return {
        'Client Name': c.name || 'Unnamed',
        'Mobile': c.mobile || '-',
        'Opening Balance': Number(c.opening_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        'Total Debit (Billing)': totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        'Total Credit (Payments)': totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        'Net Outstanding Balance': Math.abs(netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        'Status': type
      }
    })

    // Build Sheet 2: Estimates & Quotations
    const estimateRows = (estimates || []).map(e => ({
      'Bill No': e.bill_number,
      'Type': e.type || 'ESTIMATE',
      'Date': e.bill_date || '-',
      'Client': e.client_name || e.transport || 'Cash',
      'Site': e.site_name || '-',
      'Sub Total': Number(e.sub_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      'GST Amount': Number(e.gst_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      'Grand Total': Number(e.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      'Prep By': e.prepared_by || '-'
    }))

    // Build Sheet 3: Payments Log
    const paymentRows = (payments || []).map(p => ({
      'Date': p.payment_date || '-',
      'Client ID': p.client_id || '-',
      'Amount (₹)': Number(p.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      'Payment Mode': p.payment_mode || 'CASH',
      'Notes / Ref': p.notes || '-'
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
