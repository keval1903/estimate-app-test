const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'pages');

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.jsx') && f !== 'ChoosePlatform.jsx' && f !== 'Login.jsx');

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (!content.includes('useNavigate') || content.includes('usePlatform')) {
    continue;
  }

  content = content.replace(
    /import {([^}]*)useNavigate([^}]*)} from 'react-router-dom'/,
    "import {$1useNavigate$2} from 'react-router-dom'\nimport { usePlatform } from '../context/PlatformContext'"
  );

  if (!content.includes('../context/PlatformContext')) {
      content = content.replace(
        "import { useNavigate } from 'react-router-dom'",
        "import { useNavigate } from 'react-router-dom'\nimport { usePlatform } from '../context/PlatformContext'"
      );
  }

  content = content.replace(
    /const navigate = useNavigate\(\)/,
    "const navigate = useNavigate()\n  const { activePlatform } = usePlatform()"
  );

  content = content.replace(/navigate\('\/'\)/g, "navigate(`/${activePlatform}`)");
  content = content.replace(/navigate\('\/([^']+)'\)/g, "navigate(`/${activePlatform}/$1`)");
  content = content.replace(/navigate\(`\/([^$][^`]+)`\)/g, "navigate(`/${activePlatform}/$1`)");

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
}

const componentsDir = path.join(__dirname, 'src', 'components');
if (fs.existsSync(componentsDir)) {
    const compFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.jsx'));
    for (const file of compFiles) {
        const filePath = path.join(componentsDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        if (!content.includes('useNavigate') || content.includes('usePlatform')) continue;
        
        content = content.replace(
            /import {([^}]*)useNavigate([^}]*)} from 'react-router-dom'/,
            "import {$1useNavigate$2} from 'react-router-dom'\nimport { usePlatform } from '../context/PlatformContext'"
        );
        content = content.replace(
            /const navigate = useNavigate\(\)/,
            "const navigate = useNavigate()\n  const { activePlatform } = usePlatform()"
        );
        content = content.replace(/navigate\('\/'\)/g, "navigate(`/${activePlatform}`)");
        content = content.replace(/navigate\('\/([^']+)'\)/g, "navigate(`/${activePlatform}/$1`)");
        content = content.replace(/navigate\(`\/([^$][^`]+)`\)/g, "navigate(`/${activePlatform}/$1`)");
        
        fs.writeFileSync(filePath, content);
        console.log(`Updated component ${file}`);
    }
}
