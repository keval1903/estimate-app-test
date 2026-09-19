import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function createClientUser() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log("Usage: node create-client-user.mjs <username> <client_name> <mobile> [laminea_client_id]");
    process.exit(1);
  }

  const [username, client_name, mobile, laminea_client_id] = args;
  
  // Temporary password (12 chars random)
  const tempPassword = crypto.randomBytes(6).toString('hex');
  const internalEmail = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@codefinder.local`;

  console.log(`Creating user: ${username}...`);

  // 1. Create Auth User
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: internalEmail,
    password: tempPassword,
    email_confirm: true,
    app_metadata: {
      account_type: 'code_finder'
    }
  });

  if (authError) {
    console.error("Failed to create auth user:", authError.message);
    process.exit(1);
  }

  const authUserId = authData.user.id;

  // 2. Insert into code_finder_users
  const { error: dbError } = await supabase.from('code_finder_users').insert({
    auth_user_id: authUserId,
    username: username,
    client_name: client_name,
    mobile: mobile,
    laminea_client_id: laminea_client_id || null,
    is_active: true,
    must_change_password: true
  });

  if (dbError) {
    console.error("Failed to insert into code_finder_users:", dbError.message);
    // Cleanup auth user
    await supabase.auth.admin.deleteUser(authUserId);
    process.exit(1);
  }

  console.log("=========================================");
  console.log("CLIENT USER CREATED SUCCESSFULLY");
  console.log("=========================================");
  console.log(`Username: ${username}`);
  console.log(`Temporary Password: ${tempPassword}`);
  console.log(`Internal Auth Email (FYI): ${internalEmail}`);
  console.log("=========================================");
  console.log("Please securely share the username and temporary password with the client.");
}

createClientUser();
