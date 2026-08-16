import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }
    const token = authHeader.split(' ')[1];

    // 2. Initialize Supabase Admin Client
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY is not set.");
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Verify the requesting user using the JWT token
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // 4. Check if requesting user is an active ADMIN in user_roles table
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role, is_active')
      .eq('id', user.id)
      .single();

    if (roleError || !roleData) {
      return res.status(403).json({ error: 'Failed to verify user role' });
    }

    if (roleData.role !== 'ADMIN' || !roleData.is_active) {
      return res.status(403).json({ error: 'Only active Admins can create new users' });
    }

    // 5. User is validated. Create the new user.
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Create the user using the admin API, which bypasses the public sign-ups restriction
    const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Automatically confirm the email
    });

    if (createError) {
      return res.status(400).json({ error: createError.message });
    }

    // The database trigger 'handle_new_user' will automatically insert them into 'user_roles'
    return res.status(200).json({ success: true, user: { id: newUserData.user.id, email: newUserData.user.email } });

  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
