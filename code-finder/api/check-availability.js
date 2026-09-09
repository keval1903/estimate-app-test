export const config = {
  runtime: 'edge', // use edge runtime for fast proxying
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  const SUPABASE_FUNCTION_URL = process.env.SUPABASE_CHECK_AVAILABILITY_URL;
  const PROXY_SECRET = process.env.CODE_FINDER_PROXY_SECRET;

  if (!SUPABASE_FUNCTION_URL || !PROXY_SECRET) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  try {
    const body = await req.json();

    // Extract client IP for forwarded rate limiting
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

    // Forward the POST request to the Supabase Edge Function
    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-code-finder-secret': PROXY_SECRET,
        'x-forwarded-for': ip // Pass IP to Edge Function for accurate rate limiting
      },
      body: JSON.stringify(body)
    });

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    console.error('Proxy Error:', err);
    return new Response(JSON.stringify({ error: 'Failed to communicate with inventory service' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }
}
