import { getAuthenticatedUser, createErrorResponse } from '../_auth.js';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'edge',
};

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    ...NO_CACHE_HEADERS
  });

  try {
    const authData = await getAuthenticatedUser(req, headers);
    
    if (!authData) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: headers
      });
    }

    const { user, cfUser } = authData;
    const body = await req.json();
    const newPassword = body.newPassword;

    if (!newPassword || newPassword.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters.' }), {
        status: 400,
        headers: headers
      });
    }

    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Update Auth password
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword
    });

    if (authErr) {
      console.error("Auth password update error:", authErr);
      return new Response(JSON.stringify({ error: 'Failed to update password.' }), {
        status: 500,
        headers: headers
      });
    }

    // 2. Set must_change_password = false
    const { error: dbErr } = await supabaseAdmin
      .from('code_finder_users')
      .update({ must_change_password: false })
      .eq('id', cfUser.id);

    if (dbErr) {
      console.error("DB update error:", dbErr);
      return new Response(JSON.stringify({ error: 'Failed to update user profile.' }), {
        status: 500,
        headers: headers
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: headers
    });
  } catch (err) {
    console.error('Change Password Error:', err);
    return createErrorResponse('Internal Server Error', 500);
  }
}
