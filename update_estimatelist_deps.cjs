const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateList.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /\}, \[activeTab\]\)/g,
  "}, [activeTab, activePlatform])"
);

content = content.replace(
  /useEffect\(\(\) => \{\n    const t = setTimeout\(fetchEstimates, 300\)\n    return \(\) => clearTimeout\(t\)\n  \}, \[fetchEstimates\]\)/g,
  `useEffect(() => {
    setAllEstimates([])
    setSelectedIds(new Set())
    const t = setTimeout(fetchEstimates, 300)
    return () => clearTimeout(t)
  }, [fetchEstimates])`
);

fs.writeFileSync(file, content);
console.log('Fixed dependencies and clear-list in EstimateList.jsx!');
