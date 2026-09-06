const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// 3. CSV update history arrays
content = content.replace(
  /historyBatch\.push\(\{ product_id: r\.id, change_type: 'CSV_IMPORT', quantity_changed: diff \}\);/g,
  "historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: diff, platform: activePlatform });"
);

// 4. CSV insert historyBatch
content = content.replace(
  /historyBatch\.push\(\{ product_id: r\.id, change_type: 'CSV_IMPORT', quantity_changed: previewRow\.stock \}\);/g,
  "historyBatch.push({ product_id: r.id, change_type: 'CSV_IMPORT', quantity_changed: previewRow.stock, platform: activePlatform });"
);

fs.writeFileSync(file, content);
console.log('Fixed CSV stock history platforms in Products.jsx!');
