import { createClient } from '@supabase/supabase-js';
import { serialize } from 'cookie';

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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  try {
    const { username, password } = await req.json();
    
    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Invalid user ID or password.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Database-backed rate limiting
    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const hmacSecret = Deno?.env?.get?.('RATE_LIMIT_HMAC_SECRET') || process.env.RATE_LIMIT_HMAC_SECRET || 'default-hmac-key';
    const ipKeyData = new TextEncoder().encode(rawIp + hmacSecret);
    const ipHashBuf = await crypto.subtle.digest('SHA-256', ipKeyData);
    const ipHash = Array.from(new Uint8Array(ipHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
      p_namespace: 'login',
      p_key_hash: ipHash,
      p_max_requests: 10,
      p_window_seconds: 60
    });

    if (limitErr) {
      console.error('Rate limit check failed:', limitErr);
      // Fail closed
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable. Try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    if (!limitData?.allowed) {
      return new Response(JSON.stringify({ error: 'Too many login attempts. Try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // Normalize username: remove spaces, uppercase
    const normalizedUsername = username.trim().replace(/\s+/g, '').toUpperCase();

    // 1. Find user in code_finder_users using normalized username (exact match, no ILIKE)
    const { data: cfUser, error: cfErr } = await supabaseAdmin
      .from('code_finder_users')
      .select('auth_user_id, is_active')
      .eq('normalized_username', normalizedUsername)
      .single();

    if (cfErr || !cfUser) {
      return new Response(JSON.stringify({ error: 'Invalid user ID or password.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    if (!cfUser.is_active) {
      return new Response(JSON.stringify({ error: 'Invalid user ID or password.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // 2. Get auth email using Admin API
    const { data: authUser, error: authUserErr } = await supabaseAdmin.auth.admin.getUserById(cfUser.auth_user_id);
    
    if (authUserErr || !authUser.user || !authUser.user.email) {
      return new Response(JSON.stringify({ error: 'Invalid user ID or password.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // 3. Sign in to get tokens
    const { data: signInData, error: signInErr } = await supabaseAdmin.auth.signInWithPassword({
      email: authUser.user.email,
      password: password
    });

    if (signInErr || !signInData.session) {
      return new Response(JSON.stringify({ error: 'Invalid user ID or password.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // Update last_login_at
    await supabaseAdmin
      .from('code_finder_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('auth_user_id', cfUser.auth_user_id);

    // Set secure HttpOnly cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    };

    const accessTokenCookie = serialize('cf_access_token', signInData.session.access_token, cookieOptions);
    const refreshTokenCookie = serialize('cf_refresh_token', signInData.session.refresh_token, cookieOptions);

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...NO_CACHE_HEADERS
    });
    headers.append('Set-Cookie', accessTokenCookie);
    headers.append('Set-Cookie', refreshTokenCookie);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: headers
    });
  } catch (err) {
    console.error('Login Error:', err);
    return new Response(JSON.stringify({ error: 'An error occurred during login.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }
}
