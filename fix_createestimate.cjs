const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const \{ data: est, error \} = await supabase\s*\n\s*\.from\('estimates'\)\.select\('\*'\)\.eq\('id', id\)\.single\(\)/,
  "const { data: est, error } = await supabase\n          .from('estimates').select('*').eq('id', id).eq('platform', activePlatform).single()"
);

content = content.replace(
  /const \{ data: est \} = await supabase\s*\n\s*\.from\('estimates'\)\.select\('\*'\)\.eq\('id', id\)\.single\(\)/,
  "const { data: est } = await supabase\n        .from('estimates').select('*').eq('id', id).eq('platform', activePlatform).single()"
);

content = content.replace(
  /\}\)\.eq\('id', id\)\n\s*if \(estErr\) throw estErr/,
  "}).eq('id', id).eq('platform', activePlatform)\n          if (estErr) throw estErr"
);

fs.writeFileSync(file, content);
console.log('Fixed CreateEstimate cross-platform bug!');
