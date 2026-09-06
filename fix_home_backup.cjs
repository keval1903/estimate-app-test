const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Home.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "await downloadExcelBackup(supabase)",
  "await downloadExcelBackup(supabase, activePlatform)"
);

fs.writeFileSync(file, content);
console.log('Fixed Home.jsx backup call!');
