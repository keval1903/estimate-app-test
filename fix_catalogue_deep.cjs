const fs = require('fs');
const path = require('path');

// 1. Catalogue.jsx
const catFile = path.join(__dirname, 'src', 'pages', 'Catalogue.jsx');
let catContent = fs.readFileSync(catFile, 'utf8');
if (!catContent.includes(".eq('platform', activePlatform)")) {
  catContent = catContent.replace(
    /\.select\('\*'\)\n\s*\.eq\('is_returned', activeTab === 'Returned'\)/,
    ".select('*')\n          .eq('platform', activePlatform)\n          .eq('is_returned', activeTab === 'Returned')"
  );
  catContent = catContent.replace(
    /\.select\('inventory_item'\)/,
    ".select('inventory_item')\n          .eq('platform', activePlatform)"
  );
  // Also add platform to inserts
  catContent = catContent.replace(
    /inventory_item: item\.inventory_item,/g,
    "inventory_item: item.inventory_item,\n          platform: activePlatform,"
  );
  fs.writeFileSync(catFile, catContent);
  console.log('Fixed Catalogue.jsx');
}

// 2. SelectionSheetList.jsx
const sListFile = path.join(__dirname, 'src', 'pages', 'SelectionSheetList.jsx');
let sListContent = fs.readFileSync(sListFile, 'utf8');
if (!sListContent.includes(".eq('platform', activePlatform)")) {
  sListContent = sListContent.replace(
    /\.order\('updated_at', \{ ascending: false \}\)/,
    ".eq('platform', activePlatform)\n          .order('updated_at', { ascending: false })"
  );
  fs.writeFileSync(sListFile, sListContent);
  console.log('Fixed SelectionSheetList.jsx');
}

// 3. SelectionSheetEditor.jsx
const sEdFile = path.join(__dirname, 'src', 'pages', 'SelectionSheetEditor.jsx');
let sEdContent = fs.readFileSync(sEdFile, 'utf8');
if (!sEdContent.includes(".eq('platform', activePlatform)")) {
  sEdContent = sEdContent.replace(
    /const \{ data, error \} = await supabase\n\s*\.from\('selection_sheets'\)\n\s*\.select\('\*'\)\n\s*\.eq\('id', id\)/,
    "const { data, error } = await supabase\n          .from('selection_sheets')\n          .select('*')\n          .eq('platform', activePlatform)\n          .eq('id', id)"
  );
  fs.writeFileSync(sEdFile, sEdContent);
  console.log('Fixed SelectionSheetEditor.jsx');
}
