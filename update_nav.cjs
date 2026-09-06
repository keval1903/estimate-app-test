const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'pages');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.jsx') && f !== 'ChoosePlatform.jsx' && f !== 'Login.jsx' && f !== 'Home.jsx');

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Check if we already imported PLATFORM_NAMES
  if (content.includes('nav-title') && !content.includes('PLATFORM_NAMES')) {
      content = content.replace(
        /import { usePlatform } from '\.\.\/context\/PlatformContext'/,
        "import { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'"
      );

      // Replace <span className="nav-title">Title</span> with <span className="nav-title">Title - {PLATFORM_NAMES[activePlatform]}</span>
      content = content.replace(
        /<span className="nav-title">([^<]*)<\/span>/g,
        '<span className="nav-title">$1 - {PLATFORM_NAMES[activePlatform]}</span>'
      );

      fs.writeFileSync(filePath, content);
      console.log(`Updated nav title in ${file}`);
  }
}
