const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'Home.jsx');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('PLATFORM_NAMES')) {
  content = content.replace(
    /import { usePlatform } from '\.\.\/context\/PlatformContext'/,
    "import { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'"
  );
}

content = content.replace(
  /<span className="nav-title">📋 CCAI Estimate App<\/span>/,
  '<span className="nav-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>📋 {PLATFORM_NAMES[activePlatform]} Estimate App <button onClick={() => navigate("/choose-platform")} style={{ marginLeft: 10, fontSize: "0.7rem", background: "rgba(255,255,255,0.2)", color: "white", border: "none", padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}>🔄 Switch</button></span>'
);

fs.writeFileSync(filePath, content);
console.log('Updated Home.jsx header');
