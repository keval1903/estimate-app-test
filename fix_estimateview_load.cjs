const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'EstimateView.jsx');
let content = fs.readFileSync(file, 'utf8');

const search = `      const { data: est } = await supabase
        .from('estimates').select('*').eq('id', id).eq('platform', activePlatform).single()
      const { data: eitems } = await supabase
        .from('estimate_items').select('*')
        .eq('estimate_id', id).order('serial_number')`;

const replace = `      const { data: est, error: estError } = await supabase
        .from('estimates').select('*').eq('id', id).eq('platform', activePlatform).single()
      
      if (estError || !est) {
        showToast('Estimate not found in this platform', 'error')
        navigate(\`/\${activePlatform}/estimates\`, { replace: true })
        return
      }

      const { data: eitems } = await supabase
        .from('estimate_items').select('*')
        .eq('estimate_id', id).order('serial_number')`;

content = content.replace(search, replace);

fs.writeFileSync(file, content);
console.log('Fixed EstimateView load logic!');
