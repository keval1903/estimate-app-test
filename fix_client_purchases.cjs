const fs = require('fs');
const path = require('path');

const files = [
  'src/pages/ClientLedger.jsx',
  'src/pages/CreateEstimate.jsx',
  'src/pages/EstimateList.jsx',
  'src/pages/EstimateView.jsx'
];

for (const p of files) {
  const fullPath = path.join(__dirname, p);
  if (!fs.existsSync(fullPath)) continue;

  let content = fs.readFileSync(fullPath, 'utf8');

  // Regex to match .delete().eq('bill_number', ...) or .in('bill_number', ...)
  // We want to append .eq('platform', activePlatform) to it
  
  // 1. Match .eq('bill_number', ...)
  content = content.replace(
    /\.from\('client_purchases'\)\.delete\(\)\.eq\('bill_number',\s*([^\)]+)\)/g,
    ".from('client_purchases').delete().eq('bill_number', $1).eq('platform', activePlatform)"
  );

  // 2. Match .in('bill_number', ...)
  content = content.replace(
    /\.from\('client_purchases'\)\.delete\(\)\.in\('bill_number',\s*([^\)]+)\)/g,
    ".from('client_purchases').delete().in('bill_number', $1).eq('platform', activePlatform)"
  );

  fs.writeFileSync(fullPath, content);
  console.log(`Updated client_purchases delete in ${p}`);
}
