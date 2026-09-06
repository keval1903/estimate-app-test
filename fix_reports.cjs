const fs = require('fs');
const path = require('path');

// 1. Fix StockReport.jsx
const stockFile = path.join(__dirname, 'src', 'pages', 'StockReport.jsx');
let stockContent = fs.readFileSync(stockFile, 'utf8');

if (!stockContent.includes("eq(`in_${activePlatform}`, true)")) {
  stockContent = stockContent.replace(
    /const prods = await fetchAll\('products', '\*', q => q\.order\('product_name'\)\)/,
    "const prods = await fetchAll('products', '*', q => q.order('product_name').eq(`in_${activePlatform}`, true))"
  );
  stockContent = stockContent.replace(
    /const hist = await fetchAll\('stock_history', '.*?', q => q\.order\('created_at', \{ ascending: false \}\)\)/,
    "const hist = await fetchAll('stock_history', '*, products(product_name, unit, calculation_type), estimates(bill_number, site_name, type)', q => q.order('created_at', { ascending: false }).eq('platform', activePlatform))"
  );
  stockContent = stockContent.replace(
    /const sales = await fetchAll\('estimate_items', '.*?', q => q\.eq\('estimates\.type', 'ESTIMATE'\)\)/,
    "const sales = await fetchAll('estimate_items', 'product_id, quantity, nos, calculation_type_snapshot, estimates!inner(created_at, type)', q => q.eq('estimates.type', 'ESTIMATE').eq('estimates.platform', activePlatform))"
  );
  fs.writeFileSync(stockFile, stockContent);
  console.log('Fixed StockReport.jsx platform filters!');
}

// 2. Fix SalesReport.jsx
const salesFile = path.join(__dirname, 'src', 'pages', 'SalesReport.jsx');
let salesContent = fs.readFileSync(salesFile, 'utf8');
if (!salesContent.includes(".eq('platform', activePlatform)")) {
  salesContent = salesContent.replace(
    /clients!inner\(name\),\s*products\(product_group\)\s*`\)/,
    "clients!inner(name),\n          products(product_group)\n        `)\n        .eq('platform', activePlatform)"
  );
  fs.writeFileSync(salesFile, salesContent);
  console.log('Fixed SalesReport.jsx platform filters!');
}
