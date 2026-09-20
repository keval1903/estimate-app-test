import { createClient } from '@supabase/supabase-js';
import { parse, serialize } from 'cookie';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

/**
 * Authenticates the user from cookies and returns their profile.
 *
 * @param {Request} req
 * @param {Headers} headers - Response headers (cookies may be appended on token refresh).
 * @param {object}  [options]
 * @param {boolean} [options.allowPendingPassword=false] - If false (default), returns a
 *   PASSWORD_CHANGE_REQUIRED sentinel when the user still has a temporary password.
 *   Only /api/auth/me, /change-password and /logout should pass true.
 *
 * @returns {null | {error: string} | {user, cfUser, accessToken}}
 *   null           → not authenticated at all (no cookies / invalid token)
 *   {error: '...'}  → authenticated but blocked (e.g. password change required)
 *   {user, cfUser, accessToken} → fully authenticated
 */
export async function getAuthenticatedUser(req, headers, options = {}) {
  const { allowPendingPassword = false } = options;

  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = parse(cookieHeader);
  let accessToken = cookies.cf_access_token;
  const refreshToken = cookies.cf_refresh_token;

  if (!accessToken && !refreshToken) return null;

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    throw new Error('Server misconfiguration');
  }

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
      headers.append('Set-Cookie', serialize('cf_access_token', data.session.access_token, cookieOptions));
      headers.append('Set-Cookie', serialize('cf_refresh_token', data.session.refresh_token, cookieOptions));
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

  // Block business APIs when user hasn't changed their temporary password
  if (cfUser.must_change_password && !allowPendingPassword) {
    return { error: 'PASSWORD_CHANGE_REQUIRED' };
  }

  return { user, cfUser, accessToken };
}

/**
 * Helper to check if getAuthenticatedUser returned an error sentinel.
 * If so, returns an appropriate Response; otherwise returns null.
 */
export function handleAuthResult(authData, headers) {
  if (!authData) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }
  if (authData.error === 'PASSWORD_CHANGE_REQUIRED') {
    return new Response(JSON.stringify({ error: 'Password change required' }), { status: 403, headers });
  }
  return null;
}

export function createErrorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
  });
}
