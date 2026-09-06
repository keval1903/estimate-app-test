const fs = require('fs');
const path = require('path');

const clientsFile = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let content = fs.readFileSync(clientsFile, 'utf8');

content = content.replace(
  "useEffect(() => { loadClients() }, [])",
  "useEffect(() => { loadClients() }, [activePlatform])"
);

content = content.replace(
  /const \{ data: estData \} = await supabase\.from\('estimates'\)\.select\('client_id, client_name, grand_total, type, is_archived'\)\.in\('type', \['ESTIMATE', 'DELETED_ESTIMATE', 'RETURN', 'DELETED_RETURN'\]\)/,
  "const { data: estData } = await supabase.from('estimates').select('client_id, client_name, grand_total, type, is_archived').eq('platform', activePlatform).in('type', ['ESTIMATE', 'DELETED_ESTIMATE', 'RETURN', 'DELETED_RETURN'])"
);

content = content.replace(
  /const \{ data: payData \} = await supabase\.from\('payments'\)\.select\('client_id, amount, is_archived'\)/,
  "const { data: payData } = await supabase.from('payments').select('client_id, amount, is_archived').eq('platform', activePlatform)"
);

content = content.replace(
  /const \{ data: siteNamesData \} = await supabase\.from\('client_sites'\)\.select\('client_name'\)\.is\('client_id', null\)/,
  "const { data: siteNamesData } = await supabase.from('client_sites').select('client_name').eq('platform', activePlatform).is('client_id', null)"
);

fs.writeFileSync(clientsFile, content);
console.log('Fixed Clients.jsx queries and useEffect!');
