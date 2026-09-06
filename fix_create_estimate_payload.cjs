const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /bill_number: billNumber,\n\s*bill_date: billDate,/,
  "bill_number: billNumber,\n            platform: activePlatform,\n            platform_estimate_number: billNumber,\n            bill_date: billDate,"
);

fs.writeFileSync(file, content);
console.log('Fixed new estimate payload in CreateEstimate.jsx!');
