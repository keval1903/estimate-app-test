const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// Update colMap logic
content = content.replace(
  /else if \(col\.includes\('discount'\)\) colMap\['has_discount'\] = idx/,
  `else if (col.includes('discount')) colMap['has_discount'] = idx
        else if (col.includes('in ccai')) colMap['in_ccai'] = idx
        else if (col.includes('rate ccai')) colMap['rate_ccai'] = idx
        else if (col.includes('in dc')) colMap['in_dc'] = idx
        else if (col.includes('rate dc')) colMap['rate_dc'] = idx
        else if (col.includes('in materia')) colMap['in_materia'] = idx
        else if (col.includes('rate materia')) colMap['rate_materia'] = idx
        else if (col.includes('in phs')) colMap['in_phs'] = idx
        else if (col.includes('rate phs')) colMap['rate_phs'] = idx`
);

// Update hasDynamic check and assignments
content = content.replace(
  /has_discount = cols\[colMap\['has_discount'\]\]\s*\} else \{/,
  `has_discount = cols[colMap['has_discount']]
          var in_ccai = cols[colMap['in_ccai']]
          var rate_ccai = cols[colMap['rate_ccai']]
          var in_dc = cols[colMap['in_dc']]
          var rate_dc = cols[colMap['rate_dc']]
          var in_materia = cols[colMap['in_materia']]
          var rate_materia = cols[colMap['rate_materia']]
          var in_phs = cols[colMap['in_phs']]
          var rate_phs = cols[colMap['rate_phs']]
        } else {`
);

// Update rows.push
content = content.replace(
  /raw_rate: rate\?\.trim\(\),\s*errors/,
  `raw_rate: rate?.trim(),
        in_ccai: (typeof in_ccai === 'string' && (in_ccai.toLowerCase() === 'yes' || in_ccai.toLowerCase() === 'true')) || in_ccai === true,
        rate_ccai: rate_ccai ? Number(rate_ccai) : 0,
        in_dc: (typeof in_dc === 'string' && (in_dc.toLowerCase() === 'yes' || in_dc.toLowerCase() === 'true')) || in_dc === true,
        rate_dc: rate_dc ? Number(rate_dc) : 0,
        in_materia: (typeof in_materia === 'string' && (in_materia.toLowerCase() === 'yes' || in_materia.toLowerCase() === 'true')) || in_materia === true,
        rate_materia: rate_materia ? Number(rate_materia) : 0,
        in_phs: (typeof in_phs === 'string' && (in_phs.toLowerCase() === 'yes' || in_phs.toLowerCase() === 'true')) || in_phs === true,
        rate_phs: rate_phs ? Number(rate_phs) : 0,
        errors`
);

// Find handleImport where it maps to dbChunk
content = content.replace(
  /has_discount: r\.has_discount\s*}\)\)/,
  `has_discount: r.has_discount,
        in_ccai: r.in_ccai ?? true, rate_ccai: r.rate_ccai || 0,
        in_dc: r.in_dc ?? false, rate_dc: r.rate_dc || 0,
        in_materia: r.in_materia ?? false, rate_materia: r.rate_materia || 0,
        in_phs: r.in_phs ?? false, rate_phs: r.rate_phs || 0
      }))`
);

fs.writeFileSync(file, content);
console.log('Updated parseImport and handleImport in Products.jsx');
