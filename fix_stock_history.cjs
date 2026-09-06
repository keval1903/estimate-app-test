const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

// Patch 1: MANUAL_ADJUST
const search1 = `      if (payload.has_stock) {
        await supabase.from('stock_history').insert({
          product_id: data.id,
          change_type: 'MANUAL_ADJUST',
          quantity_changed: payload.stock
        })
      }`;

const replace1 = `      if (payload.has_stock) {
        await supabase.from('stock_history').insert({
          platform: activePlatform,
          product_id: data.id,
          change_type: 'MANUAL_ADJUST',
          quantity_changed: payload.stock
        })
      }`;

// Patch 2: ESTIMATE_UPDATE
const search2 = `                  if (stockDelta !== 0) {
                    const newStock = Number(p.stock) + stockDelta
                    await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
                    await supabase.from('stock_history').insert({
                      product_id: p.id,
                      change_type: isEdit ? (isReturn ? 'RETURN_UPDATE' : 'ESTIMATE_UPDATE') : (isReturn ? 'RETURN_ADD' : 'ESTIMATE_DEDUCT'),
                      quantity_changed: stockDelta,
                      estimate_id: id,
                      bill_number: existingBillNumber?.toString(),
                      site_name: siteName
                    })
                  }`;

const replace2 = `                  if (stockDelta !== 0) {
                    const newStock = Number(p.stock) + stockDelta
                    await supabase.from('products').update({ stock: newStock }).eq('id', p.id)
                    await supabase.from('stock_history').insert({
                      platform: activePlatform,
                      product_id: p.id,
                      change_type: isEdit ? (isReturn ? 'RETURN_UPDATE' : 'ESTIMATE_UPDATE') : (isReturn ? 'RETURN_ADD' : 'ESTIMATE_DEDUCT'),
                      quantity_changed: stockDelta,
                      estimate_id: id,
                      bill_number: existingBillNumber?.toString(),
                      site_name: siteName
                    })
                  }`;

content = content.replace(search1, replace1);
content = content.replace(search2, replace2);

fs.writeFileSync(file, content);
console.log('Fixed missing stock_history platforms in CreateEstimate.jsx');
