const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'lib', 'excelBackup.js');
let content = fs.readFileSync(file, 'utf8');

// 1. Signatures
content = content.replace(
  "export async function generateExcelWorkbook(supabase) {",
  "export async function generateExcelWorkbook(supabase, activePlatform) {"
);
content = content.replace(
  "export async function downloadExcelBackup(supabase) {",
  "export async function downloadExcelBackup(supabase, activePlatform) {"
);
content = content.replace(
  "const wb = await generateExcelWorkbook(supabase)",
  "const wb = await generateExcelWorkbook(supabase, activePlatform)"
);

// 2. Client query
content = content.replace(
  /\.from\('clients'\)\s*\n\s*\.select\('\*'\)/,
  ".from('clients')\n      .select('*')\n      .eq('platform', activePlatform)"
);

// 3. Payment query
content = content.replace(
  /\.from\('payments'\)\s*\n\s*\.select\('\*'\)/,
  ".from('payments')\n      .select('*')\n      .eq('platform', activePlatform)"
);

// 4. Estimate query
content = content.replace(
  /\.from\('estimates'\)\s*\n\s*\.select\('\*'\)/,
  ".from('estimates')\n      .select('*')\n      .eq('platform', activePlatform)"
);

fs.writeFileSync(file, content);
console.log('Fixed excelBackup.js queries and signatures!');
