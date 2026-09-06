const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Map products and filter
if (!content.includes('const mapped = rawData.filter')) {
  content = content.replace(
    /setAllProducts\(\[\.\.\.\(batch1\.data \|\| \[\]\), \.\.\.\(batch2\.data \|\| \[\]\)\]\)/,
    `const rawData = [...(batch1.data || []), ...(batch2.data || [])]
        const mapped = rawData.filter(p => p[\`in_\${activePlatform}\`] === true).map(p => ({
          ...p,
          rate: p[\`rate_\${activePlatform}\`] !== undefined && p[\`rate_\${activePlatform}\`] !== null ? p[\`rate_\${activePlatform}\`] : (p.rate || 0)
        }))
        setAllProducts(mapped)`
  );
}

// 2. Pass platform to RPC
content = content.replace(
  /\.rpc\('get_next_bill_number'\)/g,
  `.rpc('get_next_bill_number', { p_platform: activePlatform })`
);

// 3. Include platform and platform_estimate_number on estimate insert
if (!content.includes('platform: activePlatform')) {
  content = content.replace(
    /bill_number: billNumber,/,
    `bill_number: billNumber,
            platform_estimate_number: billNumber,
            platform: activePlatform,`
  );
  // Also on the client_purchases and stock_history inserts
  content = content.replace(
    /client_id: finalClientId,/g,
    `client_id: finalClientId,
                    platform: activePlatform,`
  );
  content = content.replace(
    /product_id: p\.id,/g,
    `product_id: p.id,
                      platform: activePlatform,`
  );
}

fs.writeFileSync(file, content);
console.log('Updated CreateEstimate.jsx for multi-platform data flow');
