const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'lib', 'stockUtils.js');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "select('*, estimates(bill_number, site_name, type)')",
  "select('*, estimates(bill_number, site_name, type, platform)')"
);

content = content.replace(
  "site_name: it.estimates?.site_name\n            });",
  "site_name: it.estimates?.site_name,\n              platform: it.estimates?.platform\n            });"
);

fs.writeFileSync(file, content);
console.log('Fixed stockUtils.js stock history platform leak!');
