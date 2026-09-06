const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'ClientSitesList.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. useEffect dependency
content = content.replace(
  "useEffect(() => {\n    fetchClients()\n  }, [])",
  "useEffect(() => {\n    fetchClients()\n  }, [activePlatform])"
);

// 2. Add platform filters to select queries
content = content.replace(
  /\.from\('clients'\)\n\s*\.select\('id, name'\)/,
  ".from('clients')\n          .select('id, name')\n          .eq('platform', activePlatform)"
);

content = content.replace(
  /\.from\('estimates'\)\n\s*\.select\('client_name'\)/,
  ".from('estimates')\n          .select('client_name')\n          .eq('platform', activePlatform)"
);

content = content.replace(
  /\.from\('client_sites'\)\n\s*\.select\('client_name'\)/,
  ".from('client_sites')\n          .select('client_name')\n          .eq('platform', activePlatform)"
);

fs.writeFileSync(file, content);
console.log('Fixed ClientSitesList queries!');
