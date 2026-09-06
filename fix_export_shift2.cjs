const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\`"\\$\{p\.keyword \|\| ''\}"\`,/,
  `"\${p.keyword || ''}",\n            \`"\${p.product_group || 'Uncategorized'}"\`,`
);

fs.writeFileSync(file, content);
console.log('Fixed export array mapping!');
