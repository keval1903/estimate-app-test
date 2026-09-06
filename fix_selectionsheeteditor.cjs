const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'SelectionSheetEditor.jsx');
let content = fs.readFileSync(file, 'utf8');

// Fix useEffect dependency
content = content.replace(
  /\}, \[id, editor\]\)/,
  "}, [id, editor, activePlatform])"
);

// Fix update payload leak
content = content.replace(
  /\}\)\.eq\('id', id\)/,
  "}).eq('id', id).eq('platform', activePlatform)"
);

fs.writeFileSync(file, content);
console.log('Fixed SelectionSheetEditor.jsx dependency and update leak!');
