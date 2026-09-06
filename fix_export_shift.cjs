const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// The issue was escaping in the regex replacement in the previous script.
// Let's replace the push array start exactly.
content = content.replace(
  /\`"\\$\{p\.keyword \|\| ''\}"\`,\s*p\.length \|\| '',/g,
  `"\${p.keyword || ''}",\n            \`"\${p.product_group || 'Uncategorized'}"\`,\n            p.length || '',`
);

fs.writeFileSync(file, content);
console.log('Fixed export array mapping!');
