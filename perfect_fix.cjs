const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add PlatformContext imports
if (!content.includes('PLATFORM_NAMES')) {
  content = content.replace(
    /import { useNavigate } from 'react-router-dom'/,
    "import { useNavigate } from 'react-router-dom'\nimport { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'"
  );
}

if (!content.includes('const { activePlatform } = usePlatform()')) {
  content = content.replace(
    /export default function Products\(\) \{\n  const \{ role \} = useAuth\(\)\n  const navigate = useNavigate\(\)/,
    "export default function Products() {\n  const { role } = useAuth()\n  const navigate = useNavigate()\n  const { activePlatform } = usePlatform()"
  );
}

// 2. Add showAllProducts state
if (!content.includes('setShowAllProducts')) {
  content = content.replace(
    /const \[search, setSearch\] = useState\(''\)/,
    "const [search, setSearch] = useState('')\n  const [showAllProducts, setShowAllProducts] = useState(false)"
  );
}

// 3. Update the export array push
if (!content.includes('p.product_group || \'Uncategorized\'')) {
  content = content.replace(
    /\`"\\$\{p\.keyword \|\| ''\}"\`,/,
    "`\"${p.keyword || ''}\"`,\n            `\"${p.product_group || 'Uncategorized'}\"`,"
  );
}

fs.writeFileSync(file, content);
console.log("Perfect fix applied to Products.jsx!");
