const fs = require('fs');
const path = require('path');

const clientsFile = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let content = fs.readFileSync(clientsFile, 'utf8');

content = content.replace(
  /await supabase\.from\('estimates'\)\.update\(\{ client_id: newClientId \}\)\.eq\('client_name', payload\.name\)\.is\('client_id', null\)/,
  "await supabase.from('estimates').update({ client_id: newClientId }).eq('platform', activePlatform).eq('client_name', payload.name).is('client_id', null)"
);

content = content.replace(
  /await supabase\.from\('client_sites'\)\.update\(\{ client_id: newClientId \}\)\.eq\('client_name', payload\.name\)\.is\('client_id', null\)/,
  "await supabase.from('client_sites').update({ client_id: newClientId }).eq('platform', activePlatform).eq('client_name', payload.name).is('client_id', null)"
);

fs.writeFileSync(clientsFile, content);
console.log('Fixed auto-linking platform constraint!');
