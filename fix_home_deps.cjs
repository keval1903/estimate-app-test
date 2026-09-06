const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Home.jsx');
let content = fs.readFileSync(file, 'utf8');

// Replace the first }, []) which corresponds to the syncOfflineCache useEffect
content = content.replace(
  /setLowStockCount\(count\)\s*\n\s*\}\s*\n\s*\}\)\s*\n\s*\}, \[\]\)/,
  "setLowStockCount(count)\n          }\n        })\n    }, [activePlatform])"
);

fs.writeFileSync(file, content);
console.log('Fixed Home.jsx useEffect dependency!');
