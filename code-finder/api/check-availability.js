import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, handleAuthResult, createErrorResponse } from './_auth.js';

export const config = {
  runtime: 'edge',
};

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

async function hmacIpHash(rawIp, userId) {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error('Server misconfiguration: RATE_LIMIT_HMAC_SECRET missing');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = new TextEncoder().encode(`${userId}:${rawIp}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);

  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }

  try {
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...NO_CACHE_HEADERS
    });

    const authData = await getAuthenticatedUser(req, headers);
    const authError = handleAuthResult(authData, headers);
    if (authError) return authError;

    const body = await req.json();
    const requests = body.requests || [];

    if (!Array.isArray(requests) || requests.length === 0) {
      return new Response(JSON.stringify({ error: 'No requests provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    if (requests.length > 25) {
      return new Response(JSON.stringify({ error: 'Max 25 codes per request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    
    const keyHash = await hmacIpHash(rawIp, authData.cfUser.id);

    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
      p_namespace: 'stock',
      p_key_hash: keyHash,
      p_max_requests: 30,
      p_window_seconds: 60
    });

    if (limitErr) {
      console.error('Rate limit check failed:', limitErr);
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    if (!limitData?.allowed) {
      return new Response(JSON.stringify({ error: limitData?.reason || 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    // Call the single unified RPC directly
    const { data: results, error: rpcErr } = await supabaseAdmin.rpc('check_laminea_stock_availability', {
      p_requests: requests
    });

    if (rpcErr) {
      console.error('RPC Error:', rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message || 'Failed to check availability' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
      });
    }

    return new Response(JSON.stringify({
      results,
      checkedAt: new Date().toISOString()
    }), {
      status: 200,
      headers: headers
    });

  } catch (err) {
    console.error('Proxy Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to communicate with inventory service' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...NO_CACHE_HEADERS }
    });
  }
}
