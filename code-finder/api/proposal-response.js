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
    return createErrorResponse('Method not allowed', 405);
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    ...NO_CACHE_HEADERS
  });

  try {
    const authData = await getAuthenticatedUser(req, headers);
    const authError = handleAuthResult(authData, headers);
    if (authError) return authError;

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return createErrorResponse('Server misconfiguration', 500);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
    const keyHash = await hmacIpHash(rawIp, authData.cfUser.id);

    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
      p_namespace: 'proposal_response',
      p_key_hash: keyHash,
      p_max_requests: 10,
      p_window_seconds: 60
    });

    if (limitErr || !limitData?.allowed) {
      return createErrorResponse('Too many requests. Please wait.', 429);
    }

    const body = await req.json();
    const { proposal_id, response } = body;

    if (!proposal_id || !response) {
       return createErrorResponse('Missing proposal_id or response', 400);
    }

    const { error: rpcErr } = await supabaseAdmin.rpc('respond_to_proposal', {
      p_proposal_id: proposal_id,
      p_user_id: authData.cfUser.id,
      p_response: response
    });

    if (rpcErr) {
      console.error('Proposal Response Error:', rpcErr);
      return createErrorResponse('Failed to save response', 400);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: headers
    });
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse('Failed to process proposal response', 502);
  }
}
