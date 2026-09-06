const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "    loadClientNames()\n  }, [id])",
  "    loadClientNames()\n  }, [id, activePlatform, isEdit, draftKey])"
);

fs.writeFileSync(file, content);
console.log('Fixed dependencies for useEffect properly!');
