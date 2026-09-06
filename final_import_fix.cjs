const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

let foundPush = false;
let foundExport = false;

for (let i = 0; i < lines.length; i++) {
  // Fix parseImport rows.push
  if (lines[i].includes('keyword: keyword ? keyword.trim() : null,')) {
    if (!lines[i+1].includes('product_group:')) {
      lines.splice(i + 1, 0, "        product_group: typeof product_group === 'string' ? product_group.trim() : 'Uncategorized',");
      console.log('Added product_group to parseImport rows.push');
      foundPush = true;
    }
  }

  // Fix handleExport csvRows.push
  if (lines[i].includes('\`"\\${p.keyword || \'\'}"\`,')) {
    if (!lines[i+1].includes('p.product_group')) {
      lines.splice(i + 1, 0, "          \`\"\\${p.product_group || 'Uncategorized'}\"\`,");
      console.log('Added product_group to handleExport csvRows.push');
      foundExport = true;
    }
  }
}

fs.writeFileSync(file, lines.join('\n'));
if (foundPush && foundExport) console.log('All fixes applied successfully!');
