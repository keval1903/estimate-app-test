const fs = require('fs');
const path = require('path');

// Fix Clients.jsx
const clientsFile = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let clientsContent = fs.readFileSync(clientsFile, 'utf8');
let clientsLines = clientsContent.split(/\r?\n/);

for (let i = 0; i < clientsLines.length; i++) {
  if (clientsLines[i].includes('const payload = {') && clientsLines[i+1].includes('name: combinedName,')) {
    clientsLines.splice(i + 1, 0, '      platform: activePlatform,');
    break;
  }
}
fs.writeFileSync(clientsFile, clientsLines.join('\n'));
console.log('Fixed platform in Clients.jsx');

// Fix ClientSitesList.jsx
const sitesFile = path.join(__dirname, 'src', 'pages', 'ClientSitesList.jsx');
let sitesContent = fs.readFileSync(sitesFile, 'utf8');
let sitesLines = sitesContent.split(/\r?\n/);

for (let i = 0; i < sitesLines.length; i++) {
  if (sitesLines[i].includes('const payload = {') && sitesLines[i+1].includes('name: name.trim().toUpperCase(),')) {
    sitesLines.splice(i + 1, 0, '          platform: activePlatform,');
    break;
  }
}
fs.writeFileSync(sitesFile, sitesLines.join('\n'));
console.log('Fixed platform in ClientSitesList.jsx');
