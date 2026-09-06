const fs = require('fs');
const path = require('path');

const clientsFile = path.join(__dirname, 'src', 'pages', 'Clients.jsx');
let clientsContent = fs.readFileSync(clientsFile, 'utf8');

// 1. Add PLATFORM_NAMES to import
clientsContent = clientsContent.replace(
  "import { usePlatform } from '../context/PlatformContext'",
  "import { usePlatform, PLATFORM_NAMES } from '../context/PlatformContext'"
);

// 2. Replace handleDeleteAllClients function completely
const oldFunc = `  async function handleDeleteAllClients() {
    if (!window.confirm('WARNING: Are you absolutely sure you want to delete ALL clients?\\n\\nThis will permanently delete EVERY ledger account and EVERY payment record in the system. This cannot be undone!')) return

    const verify = window.prompt("Type 'DELETE' to confirm wiping all ledgers.")
    if (verify !== 'DELETE') {
      if (verify !== null) alert("Deletion cancelled.")
      return
    }

    try {
      const { error } = await supabase.from('clients').delete().not('id', 'is', null)
      if (error) throw error
      loadClients()
      alert("All clients and ledgers have been successfully deleted.")
    } catch (e) {
      alert("Failed to delete all clients: " + e.message)
    }
  }`;

const newFunc = `  async function handleDeleteAllClients() {
    if (!window.confirm(\`WARNING: Are you absolutely sure you want to delete ALL clients in \${PLATFORM_NAMES[activePlatform]}?\\n\\nThis will permanently delete EVERY ledger account and EVERY payment record in this platform. This cannot be undone!\`)) return

    const verify = window.prompt(\`Type 'DELETE' to confirm wiping all ledgers in \${PLATFORM_NAMES[activePlatform]}.\`)
    if (verify !== 'DELETE') {
      if (verify !== null) alert("Deletion cancelled.")
      return
    }

    try {
      const { error } = await supabase.from('clients').delete().eq('platform', activePlatform)
      if (error) throw error
      loadClients()
      alert(\`All clients and ledgers in \${PLATFORM_NAMES[activePlatform]} have been successfully deleted.\`)
    } catch (e) {
      alert("Failed to delete all clients: " + e.message)
    }
  }`;

if (clientsContent.includes("delete().not('id', 'is', null)")) {
  clientsContent = clientsContent.replace(oldFunc, newFunc);
  fs.writeFileSync(clientsFile, clientsContent);
  console.log('Successfully updated handleDeleteAllClients logic.');
} else {
  console.log('Could not find the target code to replace.');
}
