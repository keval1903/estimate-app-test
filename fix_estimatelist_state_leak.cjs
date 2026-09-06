const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateList.jsx');
let content = fs.readFileSync(file, 'utf8');

// Fix duplicate eq
content = content.replace(
  /\.eq\('platform', activePlatform\)\s*\n\s*\.eq\('platform', activePlatform\)/,
  ".eq('platform', activePlatform)"
);

// Fix useEffect state leak
content = content.replace(
  /useEffect\(\(\) => \{\s*\n\s*const t = setTimeout\(fetchEstimates, 300\)\s*\n\s*return \(\) => clearTimeout\(t\)\s*\n\s*\}, \[fetchEstimates\]\)/,
  `useEffect(() => {
    setAllEstimates([])
    setSelectedIds(new Set())
    setCollapsedDates(new Set())
    const timer = setTimeout(fetchEstimates, 300)
    return () => clearTimeout(timer)
  }, [fetchEstimates])`
);

fs.writeFileSync(file, content);
console.log('Fixed EstimateList.jsx state leak and duplicate eq!');
