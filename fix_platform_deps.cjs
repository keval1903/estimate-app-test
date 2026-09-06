const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, searchRegex, replaceText) {
  const file = path.join(__dirname, filePath);
  if (!fs.existsSync(file)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(searchRegex, replaceText);
  fs.writeFileSync(file, content);
  console.log(`Updated ${filePath}`);
}

// 1. StockReport.jsx
replaceInFile('src/pages/StockReport.jsx', /useEffect\(\(\) => \{\s*loadData\(\)\s*\}, \[\]\)/, `useEffect(() => {
    loadData()
  }, [activePlatform])`);

// 2. SalesReport.jsx
replaceInFile('src/pages/SalesReport.jsx', /useEffect\(\(\) => \{\s*loadData\(\)\s*\}, \[\]\)/, `useEffect(() => {
    loadData()
  }, [activePlatform])`);

// 3. SelectionSheetList.jsx
replaceInFile('src/pages/SelectionSheetList.jsx', /useEffect\(\(\) => \{\s*loadData\(\)\s*\}, \[\]\)/, `useEffect(() => {
    loadData()
  }, [activePlatform])`);
replaceInFile('src/pages/SelectionSheetList.jsx', /const \{ error \} = await supabase\.from\('selection_sheets'\)\.delete\(\)\.eq\('id', id\)/, `const { error } = await supabase.from('selection_sheets').delete().eq('id', id).eq('platform', activePlatform)`);
replaceInFile('src/pages/SelectionSheetList.jsx', /const \{ error \} = await supabase\.from\('selection_sheets'\)\.delete\(\)\.in\('id', selected\)/, `const { error } = await supabase.from('selection_sheets').delete().in('id', selected).eq('platform', activePlatform)`);
replaceInFile('src/pages/SelectionSheetList.jsx', /const \{ error \} = await supabase\.from\('selection_sheets'\)\.delete\(\)\.in\('id', allIds\)/, `const { error } = await supabase.from('selection_sheets').delete().in('id', allIds).eq('platform', activePlatform)`);

// 4. Catalogue.jsx
replaceInFile('src/pages/Catalogue.jsx', /useEffect\(\(\) => \{\s*fetchData\(\)\s*\}, \[activeTab\]\)/, `useEffect(() => {
    fetchData()
  }, [activeTab, activePlatform])`);
replaceInFile('src/pages/Catalogue.jsx', /\.update\(\{\n\s*is_returned: true,\n\s*return_date: new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]\n\s*\}\)\n\s*\.eq\('id', id\)/, `.update({
          is_returned: true,
          return_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', id).eq('platform', activePlatform)`);
replaceInFile('src/pages/Catalogue.jsx', /\.delete\(\)\n\s*\.eq\('id', id\)/, `.delete()
          .eq('id', id).eq('platform', activePlatform)`);

// 5. EstimateList.jsx
replaceInFile('src/pages/EstimateList.jsx', /const \{ data: estsToDelete \} = await supabase\.from\('estimates'\)\.select\('id, type, bill_number'\)\.in\('id', arr\);/, `const { data: estsToDelete } = await supabase.from('estimates').select('id, type, bill_number').in('id', arr).eq('platform', activePlatform);`);

