import { getAuthenticatedUser, createErrorResponse } from '../_auth.js';

export const config = {
  runtime: 'edge',
};

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

export default async function handler(req) {
  if (req.method !== 'GET') {
    return createErrorResponse('Method not allowed', 405);
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    ...NO_CACHE_HEADERS
  });

  try {
    const authData = await getAuthenticatedUser(req, headers);
    
    if (!authData) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: headers
      });
    }

    const { cfUser } = authData;

    return new Response(JSON.stringify({
      user: {
        username: cfUser.username,
        client_name: cfUser.client_name,
        must_change_password: cfUser.must_change_password
      }
    }), {
      status: 200,
      headers: headers
    });
  } catch (err) {
    console.error('Me Error:', err);
    return createErrorResponse('Internal Server Error', 500);
  }
}
