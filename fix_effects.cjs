const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, searchRegex, replaceText) {
  const file = path.join(__dirname, filePath);
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(searchRegex, replaceText);
  fs.writeFileSync(file, content);
  console.log(`Updated ${filePath}`);
}

// 1. SalesReport.jsx
replaceInFile('src/pages/SalesReport.jsx', /useEffect\(\(\) => \{\n\s*fetchData\(\)\n\s*\}, \[\]\)/, `useEffect(() => {
    fetchData()
  }, [activePlatform])`);

// 2. SelectionSheetList.jsx
replaceInFile('src/pages/SelectionSheetList.jsx', /useEffect\(\(\) => \{\n\s*fetchSheets\(\)\n\s*\}, \[\]\)/, `useEffect(() => {
    fetchSheets()
  }, [activePlatform])`);
