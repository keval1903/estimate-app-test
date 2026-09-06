const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

let found = false;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('csvRows.push([')) {
    if (lines[i+1].includes('p.product_name') && !lines[i+1].includes('replace')) {
      lines[i+1] = "          `\"${(p.product_name || '').replace(/\"/g, '\"\"')}\"`,";
      lines[i+2] = "          `\"${(p.keyword || '').replace(/\"/g, '\"\"')}\"`,";
      lines[i+3] = "          `\"${(p.product_group || 'Uncategorized').replace(/\"/g, '\"\"')}\"`,";
      found = true;
      break;
    }
  }
}

fs.writeFileSync(file, lines.join('\n'));
if (found) {
  console.log('Fixed CSV quote escaping!');
} else {
  console.log('Target not found!');
}
