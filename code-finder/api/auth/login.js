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

// Simple in-memory rate limiting map (only works per Edge instance, but better than nothing).
// For production, a Redis or Supabase edge cache should be used.
const rateLimitMap = new Map();

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  // Rate Limiting
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const limit = rateLimitMap.get(ip) || { count: 0, resetTime: now + 60000 };
  
  if (now > limit.resetTime) {
    limit.count = 1;
    limit.resetTime = now + 60000;
  } else {
    limit.count++;
  }
  rateLimitMap.set(ip, limit);

  if (limit.count > 10) { // Max 10 logins per minute per IP
    return new Response(JSON.stringify({ error: 'Too many login attempts. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
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
    const cleanUsername = username.trim();

    // 1. Find user in code_finder_users using case-insensitive match
    const { data: cfUser, error: cfErr } = await supabaseAdmin
      .from('code_finder_users')
      .select('auth_user_id, is_active')
      .ilike('username', cleanUsername)
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

    const accessTokenCookie = cookie.serialize('cf_access_token', signInData.session.access_token, cookieOptions);
    const refreshTokenCookie = cookie.serialize('cf_refresh_token', signInData.session.refresh_token, cookieOptions);

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
