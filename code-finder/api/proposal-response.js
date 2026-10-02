import { getAuthenticatedUser, handleAuthResult, createErrorResponse } from './_auth.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
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

    const body = await req.json();
    const { proposal_id, response } = body;

    if (!proposal_id || !response) {
       return createErrorResponse('Missing proposal_id or response', 400);
    }

    // Follow server-only SUPABASE_URL pattern
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/client-proposal-response`;
    const PROXY_SECRET = process.env.CODE_FINDER_PROXY_SECRET;

    if (!SUPABASE_URL || !PROXY_SECRET) {
      return createErrorResponse('Server misconfiguration', 500);
    }

    const fetchOptions = {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-code-finder-secret': PROXY_SECRET,
        'Authorization': `Bearer ${authData.accessToken}`
      },
      body: JSON.stringify({ proposal_id, response })
    };

    const edgeResponse = await fetch(SUPABASE_FUNCTION_URL, fetchOptions);
    const data = await edgeResponse.text();

    return new Response(data, {
      status: edgeResponse.status,
      headers: headers
    });
  } catch (err) {
    console.error('Proposal Response Proxy Error:', err);
    return createErrorResponse('Failed to process proposal response', 502);
  }
}
