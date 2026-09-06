const fs = require('fs');
const path = require('path');

// Fix Clients.jsx
const clientsFile = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let clientsContent = fs.readFileSync(clientsFile, 'utf8');

clientsContent = clientsContent.replace(
  /const payload = \{\n\s*name: combinedName,/g,
  "const payload = {\n        platform: activePlatform,\n        name: combinedName,"
);

fs.writeFileSync(clientsFile, clientsContent);
console.log('Fixed platform in Clients.jsx');

// Fix ClientSitesList.jsx
const sitesFile = path.join(__dirname, 'src', 'pages', 'ClientSitesList.jsx');
let sitesContent = fs.readFileSync(sitesFile, 'utf8');

sitesContent = sitesContent.replace(
  /const payload = \{\n\s*name: name\.trim\(\)\.toUpperCase\(\),/g,
  "const payload = {\n          platform: activePlatform,\n          name: name.trim().toUpperCase(),"
);

fs.writeFileSync(sitesFile, sitesContent);
console.log('Fixed platform in ClientSitesList.jsx');
