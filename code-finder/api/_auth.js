import { createClient } from '@supabase/supabase-js';
import cookie from 'cookie';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

export async function getAuthenticatedUser(req, headers) {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookie.parse(cookieHeader);
  let accessToken = cookies.cf_access_token;
  const refreshToken = cookies.cf_refresh_token;

  if (!accessToken && !refreshToken) return null;

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server misconfiguration');
  }

  // We use the anon key for normal client operations to correctly manage tokens.
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let user = null;

  if (accessToken) {
    const { data: { user: authUser }, error } = await supabase.auth.getUser(accessToken);
    if (!error && authUser) user = authUser;
  }

  // If access token is expired or invalid, but we have a refresh token, try refreshing
  if (!user && refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (!error && data.session) {
      user = data.session.user;
      accessToken = data.session.access_token;
      
      // Update cookies
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7
      };
      headers.append('Set-Cookie', cookie.serialize('cf_access_token', data.session.access_token, cookieOptions));
      headers.append('Set-Cookie', cookie.serialize('cf_refresh_token', data.session.refresh_token, cookieOptions));
    }
  }

  if (!user) return null;

  // Verify Code Finder user is active
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: cfUser, error: cfUserErr } = await supabaseAdmin
    .from('code_finder_users')
    .select('id, username, client_name, is_active, must_change_password')
    .eq('auth_user_id', user.id)
    .single();

  if (cfUserErr || !cfUser || !cfUser.is_active) {
    return null;
  }

  return { user, cfUser, accessToken };
}

export function createErrorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
  });
}
