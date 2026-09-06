const fs = require('fs');
const path = require('path');

const filesToUpdate = ['00_full_database_schema.sql', '01_platform_migration.sql'];

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace 'materia' with 'laminea' (case sensitive)
    content = content.replace(/materia/g, 'laminea');
    // Replace 'Materia' with 'Laminea' (case sensitive)
    content = content.replace(/Materia/g, 'Laminea');
    // Replace 'MATERIA' with 'LAMINEA' (case sensitive)
    content = content.replace(/MATERIA/g, 'LAMINEA');

    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
  }
});
