const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '02_rename_materia_to_laminea.sql');
let content = fs.readFileSync(file, 'utf8');

const dropStr = `ALTER TABLE stock_history DROP CONSTRAINT IF EXISTS stock_history_platform_check;`;
const dropReplace = `${dropStr}
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_platform_check;
ALTER TABLE catalogue DROP CONSTRAINT IF EXISTS catalogue_platform_check;
ALTER TABLE selection_sheets DROP CONSTRAINT IF EXISTS selection_sheets_platform_check;`;

const updateStr = `UPDATE stock_history SET platform = 'laminea' WHERE platform = 'materia';`;
const updateReplace = `${updateStr}
UPDATE clients SET platform = 'laminea' WHERE platform = 'materia';
UPDATE catalogue SET platform = 'laminea' WHERE platform = 'materia';
UPDATE selection_sheets SET platform = 'laminea' WHERE platform = 'materia';`;

const addStr = `ALTER TABLE stock_history ADD CONSTRAINT stock_history_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));`;
const addReplace = `${addStr}
ALTER TABLE clients ADD CONSTRAINT clients_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
ALTER TABLE catalogue ADD CONSTRAINT catalogue_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
ALTER TABLE selection_sheets ADD CONSTRAINT selection_sheets_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));`;

content = content.replace(dropStr, dropReplace);
content = content.replace(updateStr, updateReplace);
content = content.replace(addStr, addReplace);

fs.writeFileSync(file, content);
console.log('Fixed missing constraints in migration script');
