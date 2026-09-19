import { getAuthenticatedUser, createErrorResponse } from './_auth.js';

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
    if (!authData) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const SUPABASE_FUNCTION_URL = process.env.SUPABASE_CLIENT_ENQUIRIES_URL || `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/functions/v1/client-enquiries`;
    const PROXY_SECRET = process.env.CODE_FINDER_PROXY_SECRET;

    if (!SUPABASE_FUNCTION_URL || !PROXY_SECRET) {
      return createErrorResponse('Server misconfiguration', 500);
    }

    const fetchOptions = {
      method: req.method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-code-finder-secret': PROXY_SECRET,
        'Authorization': `Bearer ${authData.accessToken}`
      }
    };

    if (req.method === 'POST') {
      const body = await req.json();
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(SUPABASE_FUNCTION_URL, fetchOptions);
    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: headers
    });
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse('Failed to communicate with enquiry service', 502);
  }
}
