const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'SiteDetailsEditor.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add platform to payload
content = content.replace(
  /const payload = \{\n\s*client_id:/,
  "const payload = {\n        platform: activePlatform,\n        client_id:"
);

// 2. Select clients
content = content.replace(
  /\.from\('clients'\)\.select\('name'\)\.eq\('id', clientId\)\.single\(\)/g,
  ".from('clients').select('name').eq('id', clientId).eq('platform', activePlatform).single()"
);

// 3. Select client_sites
content = content.replace(
  /\.from\('client_sites'\)\.select\('\*'\)\.eq\('id', siteId\)\.single\(\)/g,
  ".from('client_sites').select('*').eq('id', siteId).eq('platform', activePlatform).single()"
);

// 4. Update payload
content = content.replace(
  /\.from\('client_sites'\)\.update\(\{\n\s*\.\.\.payload,\n\s*updated_at: new Date\(\)\.toISOString\(\)\n\s*\}\)\.eq\('id', siteId\)/g,
  ".from('client_sites').update({\n            ...payload,\n            updated_at: new Date().toISOString()\n          }).eq('id', siteId).eq('platform', activePlatform)"
);

// 5. Update status COMPLETED
content = content.replace(
  /\.from\('client_sites'\)\.update\(\{\n\s*status: 'COMPLETED',\n\s*completion_date: today\n\s*\}\)\.eq\('id', siteId\)/g,
  ".from('client_sites').update({\n          status: 'COMPLETED',\n          completion_date: today\n        }).eq('id', siteId).eq('platform', activePlatform)"
);

// 6. Update status ONGOING
content = content.replace(
  /\.from\('client_sites'\)\.update\(\{\n\s*status: 'ONGOING',\n\s*completion_date: null\n\s*\}\)\.eq\('id', siteId\)/g,
  ".from('client_sites').update({\n          status: 'ONGOING',\n          completion_date: null\n        }).eq('id', siteId).eq('platform', activePlatform)"
);

fs.writeFileSync(file, content);
console.log('Fixed SiteDetailsEditor queries and payload!');
