import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Verify user token via our helper
  const authResult = await requireAuth(req, res);
  if (!authResult) return; // Response already sent by requireAuth
  const { session } = authResult;

  try {
    const { proposal_id, response } = req.body;

    if (!proposal_id || !response) {
       return res.status(400).json({ error: 'Missing proposal_id or response' });
    }

    // 2. Call the Supabase Edge Function
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const proxySecret = process.env.CODE_FINDER_PROXY_SECRET; // This must be set in Vercel env

    const edgeResponse = await fetch(`${supabaseUrl}/functions/v1/client-proposal-response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`, // Pass the client's token
        'x-code-finder-secret': proxySecret
      },
      body: JSON.stringify({ proposal_id, response })
    });

    if (!edgeResponse.ok) {
      const errText = await edgeResponse.text();
      throw new Error(errText || 'Edge Function failed');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Proposal Response Proxy Error:', error);
    return res.status(500).json({ error: 'Failed to process proposal response' });
  }
}
