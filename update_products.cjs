const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add showAllProducts state
if (!content.includes('showAllProducts')) {
  content = content.replace(
    /const \[search, setSearch\] = useState\(''\)/,
    "const [search, setSearch] = useState('')\n  const [showAllProducts, setShowAllProducts] = useState(false)"
  );
}

// 2. Update fetchProducts to map activePlatform data
content = content.replace(
  /setProducts \(\[\.\.\.\(batch1\.data \|\| \[\]\), \.\.\.\(batch2\.data \|\| \[\]\)\]\)/,
  `const allData = [...(batch1.data || []), ...(batch2.data || [])];
      const mapped = allData.map(p => ({
        ...p,
        rate: p[\`rate_\${activePlatform}\`] !== undefined && p[\`rate_\${activePlatform}\`] !== null ? p[\`rate_\${activePlatform}\`] : (p.rate || 0),
        is_available: p[\`in_\${activePlatform}\`] === true
      }));
      setProducts (mapped)`
);

// 3. Update filtered logic to check showAllProducts
if (!content.includes('!showAllProducts && !p.is_available')) {
  content = content.replace(
    /const filtered = products\.filter\(p => {/,
    `const filtered = products.filter(p => {
    if (!showAllProducts && !p.is_available) return false;`
  );
}

// 4. Update UI to add toggle switch
if (!content.includes('showAllProducts} onChange')) {
  content = content.replace(
    /<\/div>\s*<\/div>\s*<div className="page">/,
    `</div>
      </div>
      <div style={{ background: '#f8fafc', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #e2e8f0' }}>
         <input type="checkbox" id="showAll" checked={showAllProducts} onChange={e => setShowAllProducts(e.target.checked)} />
         <label htmlFor="showAll" style={{ fontSize: '0.875rem', color: '#475569', cursor: 'pointer' }}>Show products not available in {PLATFORM_NAMES[activePlatform]}</label>
      </div>
      <div className="page">`
  );
}

// 5. Update handleSave payload to save platform specific data
if (!content.includes('payload[`rate_${activePlatform}`] = Number(form.rate)')) {
  content = content.replace(
    /has_discount: form\.has_discount,\n\s*updated_at: new Date\(\)\.toISOString\(\)\n\s*}/,
    `has_discount: form.has_discount,
      updated_at: new Date().toISOString()
    }
    payload[\`rate_\${activePlatform}\`] = Number(form.rate);
    payload[\`in_\${activePlatform}\`] = true;`
  );
}

// 6. Update handleExport to include new columns
content = content.replace(
  /const headers = \['Product Name'[^\]]+\]/,
  `const headers = ['Product Name', 'Keyword', 'Length', 'Width', 'Unit', 'Calculation Type', 'Has Stock', 'Stock', 'Min Stock', 'Has Remark', 'Has Discount', 'In CCAI', 'Rate CCAI', 'In DC', 'Rate DC', 'In Laminea', 'Rate Laminea', 'In PHS', 'Rate PHS']`
);

content = content.replace(
  /csvRows\.push\(\[\s*`"\$\{p\.product_name\}"`,\s*`"\$\{p\.keyword \|\| ''\}"`,\s*p\.length \|\| '',\s*p\.width \|\| '',\s*p\.unit,\s*p\.rate,\s*p\.calculation_type,\s*p\.has_stock \? 'Yes' : 'No',\s*p\.has_stock \? p\.stock : '',\s*p\.min_stock \|\| '5',\s*p\.has_remark \? 'Yes' : 'No',\s*p\.has_discount \? 'Yes' : 'No'\s*\]\.join\(','\)\)/,
  `csvRows.push([
          \`"\${p.product_name}"\`,
          \`"\${p.keyword || ''}"\`,
          p.length || '',
          p.width || '',
          p.unit,
          p.calculation_type,
          p.has_stock ? 'Yes' : 'No',
          p.has_stock ? p.stock : '',
          p.min_stock || '5',
          p.has_remark ? 'Yes' : 'No',
          p.has_discount ? 'Yes' : 'No',
          p.in_ccai ? 'Yes' : 'No',
          p.rate_ccai || 0,
          p.in_dc ? 'Yes' : 'No',
          p.rate_dc || 0,
          p.in_laminea ? 'Yes' : 'No',
          p.rate_laminea || 0,
          p.in_phs ? 'Yes' : 'No',
          p.rate_phs || 0
        ].join(','))`
);

fs.writeFileSync(file, content);
console.log('Updated Products.jsx for data segregation');
