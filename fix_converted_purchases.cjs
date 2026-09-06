const fs = require('fs');
const path = require('path');

const files = [
  'src/pages/EstimateList.jsx',
  'src/pages/EstimateView.jsx'
];

for (const p of files) {
  const fullPath = path.join(__dirname, p);
  let content = fs.readFileSync(fullPath, 'utf8');

  content = content.replace(
    /return \{\s*client_id: finalClientId,/g,
    "return {\n            platform: activePlatform,\n            client_id: finalClientId,"
  );

  fs.writeFileSync(fullPath, content);
  console.log(`Fixed missing platform in ${p}`);
}
