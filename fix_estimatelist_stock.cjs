const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateList.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "site_name: est.site_name\n            })",
  "site_name: est.site_name,\n              platform: activePlatform\n            })"
);

fs.writeFileSync(file, content);
console.log('Fixed stock history payload in EstimateList!');
