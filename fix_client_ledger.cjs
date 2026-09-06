const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'ClientLedger.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. useEffect
content = content.replace(
  "useEffect(() => { loadData() }, [id])",
  "useEffect(() => { loadData() }, [id, activePlatform])"
);

// 2. Selects
content = content.replace(
  /\.from\('estimates'\)\.select\('\*'\)\.eq\('client_id', id\)/g,
  ".from('estimates').select('*').eq('client_id', id).eq('platform', activePlatform)"
);
content = content.replace(
  /\.from\('payments'\)\.select\('\*'\)\.eq\('client_id', id\)/g,
  ".from('payments').select('*').eq('client_id', id).eq('platform', activePlatform)"
);
content = content.replace(
  /\.from\('client_purchases'\)\.select\('\*'\)\.eq\('client_id', \n*id\)\.order/g,
  ".from('client_purchases').select('*').eq('client_id', id).eq('platform', activePlatform).order"
);
// For the one that spans a line: `.eq('client_id', \nid).order`
content = content.replace(
  /\.from\('client_purchases'\)\.select\('\*'\)\.eq\('client_id', id\)\.order/g,
  ".from('client_purchases').select('*').eq('client_id', id).eq('platform', activePlatform).order"
);

// 3. Payload
content = content.replace(
  /const payload = \{\n\s*client_id: id,/g,
  "const payload = {\n        platform: activePlatform,\n        client_id: id,"
);

// 4. Deletes & Updates
content = content.replace(
  /\.from\('payments'\)\.delete\(\)\.eq\('id', paymentId\)/g,
  ".from('payments').delete().eq('id', paymentId).eq('platform', activePlatform)"
);
content = content.replace(
  /\.from\('payments'\)\.delete\(\)\.in\('id', paymentIds\)/g,
  ".from('payments').delete().in('id', paymentIds).eq('platform', activePlatform)"
);
content = content.replace(
  /\.from\('estimates'\)\.delete\(\)\.in\('id', billIds\)/g,
  ".from('estimates').delete().in('id', billIds).eq('platform', activePlatform)"
);
content = content.replace(
  /\.from\('payments'\)\.update\(payload\)\.eq\('id', editPaymentId\)/g,
  ".from('payments').update(payload).eq('id', editPaymentId).eq('platform', activePlatform)"
);

// 5. Archive & Unarchive
content = content.replace(
  /\.from\('estimates'\)\.update\(\{ is_archived: true \}\)\.eq\('client_id', id\)\.neq/g,
  ".from('estimates').update({ is_archived: true }).eq('client_id', id).eq('platform', activePlatform).neq"
);
content = content.replace(
  /\.from\('payments'\)\.update\(\{ is_archived: true \}\)\.eq\('client_id', id\)\.neq/g,
  ".from('payments').update({ is_archived: true }).eq('client_id', id).eq('platform', activePlatform).neq"
);
content = content.replace(
  /\.from\('client_purchases'\)\.update\(\{ is_archived: true \}\)\.eq\('client_id', id\)\.neq/g,
  ".from('client_purchases').update({ is_archived: true }).eq('client_id', id).eq('platform', activePlatform).neq"
);

content = content.replace(
  /\.from\('estimates'\)\.update\(\{ is_archived: false \}\)\.eq\('client_id', id\)\.eq/g,
  ".from('estimates').update({ is_archived: false }).eq('client_id', id).eq('platform', activePlatform).eq"
);
content = content.replace(
  /\.from\('payments'\)\.update\(\{ is_archived: false \}\)\.eq\('client_id', id\)\.eq/g,
  ".from('payments').update({ is_archived: false }).eq('client_id', id).eq('platform', activePlatform).eq"
);
content = content.replace(
  /\.from\('client_purchases'\)\.update\(\{ is_archived: false \}\)\.eq\('client_id', id\)\.eq/g,
  ".from('client_purchases').update({ is_archived: false }).eq('client_id', id).eq('platform', activePlatform).eq"
);

fs.writeFileSync(file, content);
console.log('Fixed ClientLedger.jsx constraints!');
