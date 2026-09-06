const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'Clients.jsx',
  'ClientLedger.jsx',
  'ClientSitesList.jsx',
  'EstimateList.jsx',
  'StockReport.jsx',
  'SalesReport.jsx'
];

for (const file of filesToUpdate) {
  const filePath = path.join(__dirname, 'src', 'pages', file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Add platform filter to supabase selects
  // We look for: supabase.from('...').select('...') and append .eq('platform', activePlatform)
  // Be careful not to replace multiple times.
  const tablesToFilter = ['clients', 'estimates', 'stock_history', 'client_purchases', 'payments', 'client_sites'];
  
  for (const table of tablesToFilter) {
    // Only apply if we haven't already
    if (!content.includes(`.eq('platform', activePlatform)`)) {
       const regex = new RegExp(`supabase\\.from\\('${table}'\\)\\.select\\(([^)]*)\\)`, 'g');
       content = content.replace(regex, `supabase.from('${table}').select($1).eq('platform', activePlatform)`);
    }
  }

  // Same for inserts, but it's harder to generically parse object inserts.
  // We'll specifically target common inserts
  content = content.replace(
    /await supabase\.from\('clients'\)\.insert\({/g,
    `await supabase.from('clients').insert({\n      platform: activePlatform,`
  );
  content = content.replace(
    /await supabase\.from\('payments'\)\.insert\({/g,
    `await supabase.from('payments').insert({\n      platform: activePlatform,`
  );
  content = content.replace(
    /await supabase\.from\('client_sites'\)\.insert\({/g,
    `await supabase.from('client_sites').insert({\n      platform: activePlatform,`
  );

  fs.writeFileSync(filePath, content);
  console.log(`Updated data segregation in ${file}`);
}
