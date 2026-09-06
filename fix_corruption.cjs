const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.jsx');
let content = fs.readFileSync(file, 'utf8');

// The file has a duplicate handleImport block. Let's find the boundaries.
// The first occurrence of "  function handleExport() {" is what we want to keep.
// The rogue block starts immediately after the FIRST "setImportDiscrepancies(discrepancies);\n  }" 
// Let's split by "setImportDiscrepancies(discrepancies);" and see how many we have.
const parts = content.split('setImportDiscrepancies(discrepancies);');

if (parts.length === 3) {
  // It appears exactly twice.
  // parts[0] is everything before the first one
  // parts[1] is the rogue block between the first one and the second one
  // parts[2] is everything after the second one, starting with "\n  }\n\n  function handleExport() {"
  
  // Wait, let's look closer at the split boundaries:
  // After parts[0], we need to add back the first "setImportDiscrepancies(discrepancies);"
  // But wait! The first one is the rogue insert!
  // The ORIGINAL handleImportPreview ended with:
  // "        errors\n      })\n    }\n\n    // Sort rows...\n    setImportPreview(rows)\n  }"
  // And THEN "  async function handleImport() {" started.
  // The rogue text literally inserted the ENTIRE handleImport into handleImportPreview!
  // So the first "setImportDiscrepancies" belongs to the ROGUE insert.
  // Let's just find the exact string to delete.
  
  const startRogue = content.indexOf('  async function handleImport() {');
  // Wait, if it inserted handleImport into handleImportPreview, then the file has TWO 'async function handleImport() {'
  const firstImport = content.indexOf('async function handleImport() {');
  const secondImport = content.indexOf('async function handleImport() {', firstImport + 1);
  
  if (secondImport !== -1) {
    // It exists twice!
    // We want to delete from the start of the FIRST rogue chunk to right before the SECOND 'async function handleImport() {'?
    // Actually, look at the diff. The tool inserted:
    // +        errors
    // +      })
    // +    }
    // +
    // +    // Sort rows so that errors appear at the top of the list
    // +    rows.sort((a, b) => {
    // ...
    // +    setImportPreview(rows)
    // +  }
    // +
    // +  async function handleImport() {
    // ...
    // +    if (discrepancies.length > 0) setImportDiscrepancies(discrepancies);
    // +  }
    // +
    
    // So the entire inserted block is exactly what it was supposed to REPLACE, but it didn't replace it, it just inserted it!
    // No wait, it DID replace it! But it replaced:
    // -        csvRows.push([
    // -            `"${p.product_name}"`,
    // -            `"${p.keyword || ''}"`,
    // -            p.length || '',
    
    // Oh my god! It replaced `csvRows.push` with `errors...handleImport...csvRows.push`!
    // That means `handleImport` is sitting inside `handleExport`!!
    
    // Let's just restore from git and re-apply my node scripts. That is 1000x safer.
    
    console.log("Too messy, restoring from git");
  }
}

