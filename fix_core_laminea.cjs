const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'src/pages/Products.jsx',
  'src/lib/excelBackup.js',
  'src/pages/ClientLedger.jsx', // Material -> Material is fine, but wait, 'Materia' -> 'Laminea' is what we want.
  'src/pages/SiteDetailsEditor.jsx', // "Material Details" should not be changed to "Laminea Details"
  'fix_product_group.cjs',
  'update_products.cjs',
  'update_products_import.cjs'
];

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Only replacing exact matches of 'materia' and 'Materia'
    // Let's be careful not to replace 'material' (which has an 'l' at the end)
    
    // Word boundary replace for materia
    content = content.replace(/\bmateria\b/g, 'laminea');
    content = content.replace(/\bMateria\b/g, 'Laminea');
    content = content.replace(/\bMATERIA\b/g, 'LAMINEA');
    
    // Replace in_materia and rate_materia
    content = content.replace(/in_materia/g, 'in_laminea');
    content = content.replace(/rate_materia/g, 'rate_laminea');

    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
  }
});
