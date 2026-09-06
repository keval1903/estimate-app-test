const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

const target = `    for (const p of filtered) {
      csvRows.push([
          \`"\${p.product_name}"\`,
          \`"\${p.keyword || ''}"\`,
          p.length || '',
          p.width || '',
          p.unit,`;

const replacement = `    for (const p of filtered) {
      csvRows.push([
          \`"\${p.product_name}"\`,
          \`"\${p.keyword || ''}"\`,
          \`"\${p.product_group || 'Uncategorized'}"\`,
          p.length || '',
          p.width || '',
          p.unit,`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content);
  console.log('Fixed export array shift!');
} else {
  console.log('Target not found!');
}
