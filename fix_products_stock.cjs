const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Product creation history (around line 125 in save)
content = content.replace(
  /change_type: 'MANUAL_ADJUST',\s*\n\s*quantity_changed: diff !== 0 \? diff : payload\.stock\s*\n\s*\}\)/,
  "change_type: 'MANUAL_ADJUST',\n          quantity_changed: diff !== 0 ? diff : payload.stock,\n          platform: activePlatform\n        })"
);

// 2. Individual stock adjustment (around line 211)
content = content.replace(
  /change_type: 'MANUAL_ADJUST',\s*\n\s*quantity_changed: qty\s*\n\s*\}\);/,
  "change_type: 'MANUAL_ADJUST',\n          quantity_changed: qty,\n          platform: activePlatform\n        });"
);

// 3. Bulk stock update / CSV update history arrays (lines 280, 310)
// For these, we need to push platform into the historyBatch.
content = content.replace(
  /historyBatch\.push\(\{\s*\n\s*product_id: data\.id,\s*\n\s*change_type: 'MANUAL_ADJUST',\s*\n\s*quantity_changed: diff\s*\n\s*\}\)/g,
  "historyBatch.push({\n            product_id: data.id,\n            change_type: 'MANUAL_ADJUST',\n            quantity_changed: diff,\n            platform: activePlatform\n          })"
);

// For Insert historyBatch
content = content.replace(
  /historyBatch\.push\(\{\s*\n\s*product_id: data\.id,\s*\n\s*change_type: 'MANUAL_ADJUST',\s*\n\s*quantity_changed: c\.stock\s*\n\s*\}\)/g,
  "historyBatch.push({\n            product_id: data.id,\n            change_type: 'MANUAL_ADJUST',\n            quantity_changed: c.stock,\n            platform: activePlatform\n          })"
);

fs.writeFileSync(file, content);
console.log('Fixed stock history platforms in Products.jsx!');
