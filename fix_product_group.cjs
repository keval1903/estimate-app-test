const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Export headers
content = content.replace(
  /const headers = \['Product Name', 'Keyword', 'Length', 'Width'/,
  "const headers = ['Product Name', 'Keyword', 'Product Group', 'Length', 'Width'"
);

// 2. Export csvRows.push
content = content.replace(
  /\`"\\$\{p\.keyword \|\| ''\}"\`,/,
  `"\${p.keyword || ''}",\n          \`"\${p.product_group || ''}"\`,`
);

// 3. Import colMap mapping
content = content.replace(
  /else if \(col\.includes\('keyword'\)\) colMap\['keyword'\] = idx/,
  "else if (col.includes('keyword')) colMap['keyword'] = idx\n        else if (col.includes('group')) colMap['product_group'] = idx"
);

// 4. Import variable declarations
content = content.replace(
  /let product_name, keyword, length, width,/,
  "let product_name, keyword, product_group, length, width,"
);

// 5. Import hasDynamic assignment
content = content.replace(
  /keyword = cols\[colMap\['keyword'\]\]/,
  "keyword = cols[colMap['keyword']]\n          product_group = cols[colMap['product_group']]"
);

// 6. Import fallback parsing block
content = content.replace(
  /else \{\n\s*if \(isNewFormat\) \{\n\s*product_name = cols\[0\]\n\s*keyword = cols\[1\]\n\s*length = cols\[2\]/,
  `else {
          if (isNewFormat) {
            product_name = cols[0]
            keyword = cols[1]
            product_group = cols[2]
            length = cols[3]`
);

content = content.replace(
  /width = cols\[3\]\n\s*unit = cols\[4\]\n\s*rate = cols\[5\]\n\s*calculation_type = cols\[6\]\n\s*has_stock = cols\[7\]\n\s*stock = cols\[8\]\n\s*min_stock = cols\[9\]\n\s*has_remark = cols\[10\]\n\s*has_discount = cols\[11\]\n\s*var in_ccai = cols\[12\]\n\s*var rate_ccai = cols\[13\]/,
  `width = cols[4]
            unit = cols[5]
            rate = cols[6]
            calculation_type = cols[7]
            has_stock = cols[8]
            stock = cols[9]
            min_stock = cols[10]
            has_remark = cols[11]
            has_discount = cols[12]
            var in_ccai = cols[13]
            var rate_ccai = cols[14]`
);

content = content.replace(
  /var in_dc = cols\[14\]\n\s*var rate_dc = cols\[15\]\n\s*var in_laminea = cols\[16\]\n\s*var rate_laminea = cols\[17\]\n\s*var in_phs = cols\[18\]\n\s*var rate_phs = cols\[19\]/,
  `var in_dc = cols[15]
            var rate_dc = cols[16]
            var in_laminea = cols[17]
            var rate_laminea = cols[18]
            var in_phs = cols[19]
            var rate_phs = cols[20]`
);

// 7. Import row pushing
content = content.replace(
  /keyword: keyword\?\.trim\(\),/,
  "keyword: keyword?.trim(),\n        product_group: product_group?.trim() || 'Uncategorized',"
);

// 8. Import db mapping
content = content.replace(
  /keyword: r\.keyword,/,
  "keyword: r.keyword,\n        product_group: r.product_group,"
);

fs.writeFileSync(file, content);
console.log('Fixed Product Group logic in Products.jsx');
