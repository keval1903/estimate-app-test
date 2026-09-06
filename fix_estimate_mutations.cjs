const fs = require('fs');
const path = require('path');

function replaceInFile(filepath, replacements) {
  const file = path.join(__dirname, filepath);
  let content = fs.readFileSync(file, 'utf8');
  for (const { search, replace } of replacements) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(file, content);
  console.log(`Patched ${filepath}`);
}

replaceInFile('src/pages/EstimateView.jsx', [
  { search: /\}\)\.eq\('id', id\)/g, replace: "}).eq('id', id).eq('platform', activePlatform)" }
]);

replaceInFile('src/pages/CreateEstimate.jsx', [
  { search: /\}\)\.eq\('id', id\)/g, replace: "}).eq('id', id).eq('platform', activePlatform)" }
]);

replaceInFile('src/pages/Clients.jsx', [
  { search: /\.update\(\{ client_name: payload\.name \}\)\.eq\('client_id', editClientId\)/g, replace: ".update({ client_name: payload.name }).eq('client_id', editClientId).eq('platform', activePlatform)" }
]);

replaceInFile('src/pages/EstimateList.jsx', [
  { search: /\.delete\(\)\.eq\('id', est\.id\)/g, replace: ".delete().eq('id', est.id).eq('platform', activePlatform)" },
  { search: /\.update\(\{ type: newType \}\)\.eq\('id', est\.id\)/g, replace: ".update({ type: newType }).eq('id', est.id).eq('platform', activePlatform)" },
  { search: /\.update\(\{ type: 'DELETED_ESTIMATE' \}\)\.in\('id', softDeleteIds\)/g, replace: ".update({ type: 'DELETED_ESTIMATE' }).in('id', softDeleteIds).eq('platform', activePlatform)" },
  { search: /\.update\(\{ type: 'DELETED_RETURN' \}\)\.in\('id', returnSoftDeleteIds\)/g, replace: ".update({ type: 'DELETED_RETURN' }).in('id', returnSoftDeleteIds).eq('platform', activePlatform)" },
  { search: /\.delete\(\)\.in\('id', hardDeleteIds\)/g, replace: ".delete().in('id', hardDeleteIds).eq('platform', activePlatform)" },
  { search: /\}\)\.eq\('id', est\.id\)/g, replace: "}).eq('id', est.id).eq('platform', activePlatform)" }
]);

console.log('Fixed bulk estimate mutation leaks!');
