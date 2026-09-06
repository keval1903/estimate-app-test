const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i] === "import { useNavigate } from 'react-router-dom'") {
    if (!lines[i+1].includes('PLATFORM_NAMES')) {
      lines.splice(i + 1, 0, "import { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'");
    }
  }
  
  if (lines[i] === "  const navigate = useNavigate()") {
    if (!lines[i+1].includes('activePlatform')) {
      lines.splice(i + 1, 0, "  const { activePlatform } = usePlatform()");
    }
  }
  
  if (lines[i] === "  const [search, setSearch] = useState('')") {
    if (!lines[i+1].includes('showAllProducts')) {
      lines.splice(i + 1, 0, "  const [showAllProducts, setShowAllProducts] = useState(false)");
    }
  }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed imports successfully!');
