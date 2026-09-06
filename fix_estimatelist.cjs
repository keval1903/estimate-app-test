const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateList.jsx');
let content = fs.readFileSync(file, 'utf8');

if (!content.includes(".eq('platform', activePlatform)\n          .order('bill_number'")) {
  content = content.replace(
    /\.order\('bill_number',\s*\{\s*ascending:\s*false\s*\}\)/,
    ".eq('platform', activePlatform)\n          .order('bill_number', { ascending: false })"
  );
  fs.writeFileSync(file, content);
  console.log('Fixed EstimateList.jsx activePlatform filter!');
} else {
  console.log('EstimateList.jsx already has the filter.');
}
