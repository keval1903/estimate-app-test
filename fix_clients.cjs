const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let content = fs.readFileSync(file, 'utf8');

// Patch 1: Update
const search1 = `const { error: err } = await supabase.from('clients').update(payload).eq('id', editClientId)`;
const replace1 = `const { error: err } = await supabase.from('clients').update(payload).eq('id', editClientId).eq('platform', activePlatform)`;

// Patch 2: Delete single
const search2 = `const { error } = await supabase.from('clients').delete().eq('id', id)`;
const replace2 = `const { error } = await supabase.from('clients').delete().eq('id', id).eq('platform', activePlatform)`;

// Patch 3: Delete bulk
const search3 = `const { error } = await supabase.from('clients').delete().in('id', Array.from(selectedClients))`;
const replace3 = `const { error } = await supabase.from('clients').delete().in('id', Array.from(selectedClients)).eq('platform', activePlatform)`;

content = content.replace(search1, replace1);
content = content.replace(search2, replace2);
content = content.replace(search3, replace3);

fs.writeFileSync(file, content);
console.log('Fixed platform filters in Clients.jsx');
