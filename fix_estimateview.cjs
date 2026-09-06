const fs = require('fs');
const path = require('path');

const evFile = path.join(__dirname, 'src', 'pages', 'EstimateView.jsx');
let evContent = fs.readFileSync(evFile, 'utf8');

if (!evContent.includes("eq('platform', activePlatform)")) {
  // Fix clients lookup
  evContent = evContent.replace(
    /supabase\.from\('clients'\)\.select\('id'\)\.eq\('name', cName\)/g,
    "supabase.from('clients').select('id').eq('platform', activePlatform).eq('name', cName)"
  );
  
  // Fix stock_history insert
  evContent = evContent.replace(
    /await supabase\.from\('stock_history'\)\.insert\(\{/g,
    "await supabase.from('stock_history').insert({\n                platform: activePlatform,"
  );
  
  // Fix client_purchases array creation for insert
  evContent = evContent.replace(
    /return \{\n\s*client_id: finalClientId,/g,
    "return {\n              platform: activePlatform,\n              client_id: finalClientId,"
  );

  fs.writeFileSync(evFile, evContent);
  console.log('Fixed EstimateView.jsx data segregation!');
}
