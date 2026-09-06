const fs = require('fs');
const path = require('path');

const createEstimateFile = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let ceContent = fs.readFileSync(createEstimateFile, 'utf8');

ceContent = ceContent.replace(
  "site_name: siteName\n                    })",
  "site_name: siteName,\n                      platform: activePlatform\n                    })"
);

fs.writeFileSync(createEstimateFile, ceContent);
console.log('Fixed CreateEstimate.jsx stock history payload!');

const estimateListFile = path.join(__dirname, 'src', 'pages', 'EstimateList.jsx');
let elContent = fs.readFileSync(estimateListFile, 'utf8');

elContent = elContent.replace(
  "site_name: est.site_name\n              })",
  "site_name: est.site_name,\n                platform: activePlatform\n              })"
);

fs.writeFileSync(estimateListFile, elContent);
console.log('Fixed EstimateList.jsx stock history payload!');
