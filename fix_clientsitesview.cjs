const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'ClientSitesView.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\.from\('clients'\)\.select\('name'\)\.eq\('id', clientId\)\.single\(\)/g,
  ".from('clients').select('name').eq('id', clientId).eq('platform', activePlatform).single()"
);

content = content.replace(
  /\.from\('client_sites'\)\.select\('\*'\)\.eq\('client_id', clientId\)\.order\('created_at', \{ ascending: false \}\)/g,
  ".from('client_sites').select('*').eq('client_id', clientId).eq('platform', activePlatform).order('created_at', { ascending: false })"
);

content = content.replace(
  /\.from\('client_sites'\)\.select\('\*'\)\.eq\('client_name', decodedName\)\.is\('client_id', null\)\.order\('created_at', \{ ascending: false \}\)/g,
  ".from('client_sites').select('*').eq('client_name', decodedName).is('client_id', null).eq('platform', activePlatform).order('created_at', { ascending: false })"
);

content = content.replace(
  /\.from\('client_sites'\)\.delete\(\)\.eq\('id', id\)/g,
  ".from('client_sites').delete().eq('id', id).eq('platform', activePlatform)"
);

content = content.replace(
  /\}, \[clientId\]\)/g,
  "}, [clientId, activePlatform])"
);

fs.writeFileSync(file, content);
console.log('Fixed ClientSitesView.jsx leak!');
