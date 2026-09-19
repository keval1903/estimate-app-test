import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  const cookieHeader = req.headers.get('cookie');
  let accessToken = null;
  if (cookieHeader) {
    const cookies = cookie.parse(cookieHeader);
    accessToken = cookies.cf_access_token;
  }

  if (accessToken) {
    // Revoke Supabase session
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
      });
      await supabase.auth.signOut();
    }
  }

  // Clear cookies
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0)
  };

  const headers = new Headers({
    'Content-Type': 'application/json',
    ...NO_CACHE_HEADERS
  });
  headers.append('Set-Cookie', cookie.serialize('cf_access_token', '', cookieOptions));
  headers.append('Set-Cookie', cookie.serialize('cf_refresh_token', '', cookieOptions));

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: headers
  });
}
