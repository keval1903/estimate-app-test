const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

// Replace standard selects
const tablesToFilter = ['clients', 'estimates', 'payments', 'sites'];
for (const table of tablesToFilter) {
  const regex = new RegExp(`supabase\\.from\\('${table}'\\)\\.select\\(([^)]*)\\)`, 'g');
  content = content.replace(regex, (match, p1) => {
    // If it already has platform filter, skip
    if (match.includes("eq('platform', activePlatform)")) return match;
    return `supabase.from('${table}').select(${p1}).eq('platform', activePlatform)`;
  });
}

fs.writeFileSync(file, content);
console.log('Fixed CreateEstimate.jsx queries!');
