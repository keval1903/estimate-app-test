const fs = require('fs');
const path = require('path');

// Fix CreateEstimate
const ceFile = path.join(__dirname, 'src', 'pages', 'CreateEstimate.jsx');
let ceContent = fs.readFileSync(ceFile, 'utf8');

ceContent = ceContent.replace(
  /const draftKey = isEdit \? \`estimate_draft_\$\{id\}\` : 'estimate_draft_new'/,
  "const draftKey = isEdit ? `estimate_draft_${activePlatform}_${id}` : `estimate_draft_new_${activePlatform}`"
);

fs.writeFileSync(ceFile, ceContent);

// Fix SiteDetailsEditor
const sdFile = path.join(__dirname, 'src', 'pages', 'SiteDetailsEditor.jsx');
let sdContent = fs.readFileSync(sdFile, 'utf8');

sdContent = sdContent.replace(
  /const draftKey = siteId === 'new' \? 'site_draft_new' : \`site_draft_\$\{siteId\}\`/,
  "const draftKey = siteId === 'new' ? `site_draft_new_${activePlatform}` : `site_draft_${activePlatform}_${siteId}`"
);

fs.writeFileSync(sdFile, sdContent);
console.log('Fixed draft keys across both files!');
