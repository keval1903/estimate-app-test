import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envFile = fs.readFileSync('.env', 'utf8');
const SUPABASE_URL = envFile.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const SUPABASE_KEY = envFile.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: enqs } = await supabase.from('code_finder_enquiries').select('id, enquiry_number').limit(1);
  console.log("Enquiry:", enqs[0]);
  
  if (enqs[0]) {
    const { data, error } = await supabase.rpc('resolve_enquiry_items', { p_enquiry_id: enqs[0].id });
    console.log("RPC Data typeof:", typeof data);
    console.log("IsArray?", Array.isArray(data));
    console.log("RPC Data:", JSON.stringify(data, null, 2));
    if (error) console.log("RPC Error:", error);
  }
}

run();
