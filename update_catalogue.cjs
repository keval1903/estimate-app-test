const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'Catalogue.jsx',
  'SelectionSheetList.jsx',
  'SelectionSheetEditor.jsx'
];

for (const file of filesToUpdate) {
  const filePath = path.join(__dirname, 'src', 'pages', file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Add platform filter to supabase selects
  const tablesToFilter = ['catalogue', 'selection_sheets'];
  
  for (const table of tablesToFilter) {
    if (!content.includes(`.eq('platform', activePlatform)`)) {
       const regex = new RegExp(`supabase\\.from\\('${table}'\\)\\.select\\(([^)]*)\\)`, 'g');
       content = content.replace(regex, `supabase.from('${table}').select($1).eq('platform', activePlatform)`);
    }
  }

  // Update inserts
  content = content.replace(
    /await supabase\.from\('catalogue'\)\.insert\({/g,
    `await supabase.from('catalogue').insert({\n      platform: activePlatform,`
  );
  content = content.replace(
    /await supabase\.from\('selection_sheets'\)\.insert\({/g,
    `await supabase.from('selection_sheets').insert({\n      platform: activePlatform,`
  );

  fs.writeFileSync(filePath, content);
  console.log(`Updated data segregation in ${file}`);
}
