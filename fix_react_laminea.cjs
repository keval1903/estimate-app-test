const fs = require('fs');
const path = require('path');

const contextFile = path.join(__dirname, 'src', 'context', 'PlatformContext.jsx');
let ctxContent = fs.readFileSync(contextFile, 'utf8');
ctxContent = ctxContent.replace(/materia/g, 'laminea');
ctxContent = ctxContent.replace(/Materia/g, 'Laminea');
fs.writeFileSync(contextFile, ctxContent);

const chooseFile = path.join(__dirname, 'src', 'pages', 'ChoosePlatform.jsx');
let chooseContent = fs.readFileSync(chooseFile, 'utf8');
chooseContent = chooseContent.replace(/materia/g, 'laminea');
chooseContent = chooseContent.replace(/Materia/g, 'Laminea');
fs.writeFileSync(chooseFile, chooseContent);

console.log('Fixed React context and choose platform UI');
