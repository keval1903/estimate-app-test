const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'SelectionSheetEditor.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\.from\('selection_sheets'\)\s*\.select\('\*'\)\s*\.eq\('id', id\)\s*\.single\(\)/,
  ".from('selection_sheets').select('*').eq('id', id).eq('platform', activePlatform).single()"
);

content = content.replace(
  /navigate\('\/selection-sheets', \{ replace: true \}\)/g,
  "navigate(`/${activePlatform}/selection-sheets`, { replace: true })"
);

fs.writeFileSync(file, content);
console.log('Fixed SelectionSheetEditor platform leak and routing!');
