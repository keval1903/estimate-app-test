const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'pages');

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.jsx') && f !== 'ChoosePlatform.jsx' && f !== 'Login.jsx');

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Skip if already processed or doesn't have useNavigate
  if (!content.includes('useNavigate') || content.includes('usePlatform')) {
    continue;
  }

  // Add import for usePlatform
  content = content.replace(
    /import {([^}]*)useNavigate([^}]*)} from 'react-router-dom'/,
    "import {$1useNavigate$2} from 'react-router-dom'\nimport { usePlatform } from '../context/PlatformContext'"
  );

  // If the import was separate (e.g. import { useNavigate } ... )
  if (!content.includes('../context/PlatformContext')) {
      content = content.replace(
        "import { useNavigate } from 'react-router-dom'",
        "import { useNavigate } from 'react-router-dom'\nimport { usePlatform } from '../context/PlatformContext'"
      );
  }

  // Add activePlatform hook after useNavigate
  content = content.replace(
    /const navigate = useNavigate\(\)/,
    "const navigate = useNavigate()\n  const { activePlatform } = usePlatform()"
  );

  // Replace navigate('/') with navigate(`/${activePlatform}`)
  content = content.replace(/navigate\('\/'\)/g, "navigate(`/${activePlatform}`)");
  
  // Replace navigate('/something') with navigate(`/${activePlatform}/something`)
  content = content.replace(/navigate\('\/([^']+)'\)/g, "navigate(`/${activePlatform}/$1`)");

  // Replace navigate(`/something`) with navigate(`/${activePlatform}/something`)
  // careful not to replace `/${activePlatform}` again if ran multiple times
  content = content.replace(/navigate\(`\/([^$][^`]+)`\)/g, "navigate(`/${activePlatform}/$1`)");

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
}

// Components
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
