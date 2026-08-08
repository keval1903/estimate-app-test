import { supabase } from './supabase'

export async function restoreStockForEstimates(estIds) {
  if (!estIds || estIds.length === 0) return;
  
  try {
    const { data: items } = await supabase
      .from('estimate_items')
      .select('*, estimates(bill_number, site_name, type)')
      .in('estimate_id', estIds);
      
    if (!items || items.length === 0) return;

    const { data: allProducts } = await supabase.from('products').select('*');
    const prodMap = {};
    for (const p of (allProducts || [])) prodMap[p.id] = p;

    for (const it of items) {
      if (it.product_id && prodMap[it.product_id] && prodMap[it.product_id].has_stock) {
        const qty = (it.calculation_type_snapshot === 'SQFT' || it.calculation_type_snapshot === 'INCH' || it.calculation_type_snapshot === 'FEET') ? (parseFloat(it.nos) || 0) : (parseFloat(it.quantity) || 0);
        
        if (qty > 0) {
          const type = it.estimates?.type;
          if (type === 'ESTIMATE' || type === 'RETURN') {
            const p = prodMap[it.product_id];
            const isReturn = type === 'RETURN';
            const stockDelta = isReturn ? -qty : qty; // Returning a return means deducting stock
            const newStock = Number(p.stock) + stockDelta;
            
            await supabase.from('products').update({ stock: newStock }).eq('id', p.id);
            prodMap[it.product_id].stock = newStock; // Update local map for subsequent items
            
            await supabase.from('stock_history').insert({
              product_id: p.id,
              change_type: 'ESTIMATE_DELETED_RESTORE',
              quantity_changed: stockDelta,
              estimate_id: it.estimate_id,
              bill_number: it.estimates?.bill_number?.toString(),
              site_name: it.estimates?.site_name
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to restore stock for deleted estimates:", error);
  }
}
