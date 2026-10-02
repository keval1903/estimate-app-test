import { getAuthenticatedUser, handleAuthResult, createErrorResponse } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return createErrorResponse('Method not allowed', 405);
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });

  try {
    const authData = await getAuthenticatedUser(req, headers);
    const authError = handleAuthResult(authData, headers);
    if (authError) return authError;

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return createErrorResponse('Server misconfiguration', 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authData.accessToken}` } }
    });

    if (req.method === 'POST') {
      const { endpoint, keys } = await req.json();
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return createErrorResponse('Invalid subscription object', 400);
      }

      const { error } = await supabase.rpc('bind_push_subscription', {
        p_endpoint: endpoint,
        p_keys_p256dh: keys.p256dh,
        p_keys_auth: keys.auth
      });

      if (error) {
        console.error('RPC Error:', error);
        throw error;
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    if (req.method === 'DELETE') {
      const { endpoint } = await req.json();
      if (!endpoint) return createErrorResponse('Endpoint required', 400);

      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', authData.user.id)
        .eq('endpoint', endpoint);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

  } catch (err) {
    console.error('Push Subscription Error:', err);
    return createErrorResponse('Failed to manage push subscription', 500);
  }
}
