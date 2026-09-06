const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateView.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\.from\('estimates'\)\.select\('\*'\)\.eq\('id', id\)\.single\(\)/,
  ".from('estimates').select('*').eq('id', id).eq('platform', activePlatform).single()"
);

content = content.replace(
  /\}, \[id\]\)/,
  "}, [id, activePlatform])"
);

fs.writeFileSync(file, content);
console.log('Fixed EstimateView cross-platform bug!');
