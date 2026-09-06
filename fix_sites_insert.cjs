const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /await supabase\.from\('sites'\)\.insert\(\{ site_name: name \}\)/,
  "await supabase.from('sites').insert({ site_name: name, platform: activePlatform })"
);

fs.writeFileSync(file, content);
console.log('Fixed sites insert in CreateEstimate!');
