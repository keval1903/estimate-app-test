const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Fix MANUAL_ADJUST
content = content.replace(
  /change_type: 'MANUAL_ADJUST',\s*\n\s*quantity_changed: payload\.stock\s*\n\s*\}/g,
  "change_type: 'MANUAL_ADJUST',\n          quantity_changed: payload.stock,\n          platform: activePlatform\n        }"
);

// 2. Fix isEdit stock_history insert
content = content.replace(
  /bill_number: existingBillNumber\?\.toString\(\),\s*\n\s*site_name: siteName\s*\n\s*\}\)/g,
  "bill_number: existingBillNumber?.toString(),\n                      site_name: siteName,\n                      platform: activePlatform\n                    })"
);

fs.writeFileSync(file, content);
console.log('Fixed stock history platforms in CreateEstimate.jsx!');
