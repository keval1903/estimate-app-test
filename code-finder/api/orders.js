import { getAuthenticatedUser, handleAuthResult, createErrorResponse } from './_auth.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return createErrorResponse('Method not allowed', 405);
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });

  try {
    const authData = await getAuthenticatedUser(req, headers);
    const authError = handleAuthResult(authData, headers);
    if (authError) return authError;

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_FUNCTION_URL = process.env.SUPABASE_CLIENT_ORDERS_URL || `${SUPABASE_URL}/functions/v1/client-orders`;
    const PROXY_SECRET = process.env.CODE_FINDER_PROXY_SECRET;

    if (!SUPABASE_URL || !SUPABASE_FUNCTION_URL || !PROXY_SECRET) {
      return createErrorResponse('Server misconfiguration', 500);
    }

    if (req.method === 'POST') {
      const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!SUPABASE_ANON_KEY) {
        return createErrorResponse('Server misconfiguration', 500);
      }
      
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authData.accessToken}` } }
      });

      const { enquiry_id, idempotency_key } = await req.json();
      if (!enquiry_id || !idempotency_key) {
        return createErrorResponse('Missing required fields', 400);
      }

      const { data: orderData, error } = await supabase.rpc('place_code_finder_order', {
        p_enquiry_id: enquiry_id,
        p_idempotency_key: idempotency_key
      });

      if (error) {
        return createErrorResponse(error.message, 400);
      }

      return new Response(JSON.stringify({ success: true, order: orderData }), {
        status: 200,
        headers: headers
      });
    }

    const fetchOptions = {
      method: req.method,
      cache: 'no-store, no-cache, must-revalidate',
      headers: {
        'Content-Type': 'application/json',
        'x-code-finder-secret': PROXY_SECRET,
        'Authorization': `Bearer ${authData.accessToken}`
      }
    };

    const response = await fetch(SUPABASE_FUNCTION_URL, fetchOptions);
    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: headers
    });
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse('Failed to communicate with orders service', 502);
  }
}
