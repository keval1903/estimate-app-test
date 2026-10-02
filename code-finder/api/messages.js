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
  if (req.method !== 'GET' && req.method !== 'POST') {
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

    if (req.method === 'GET') {
      const incomingUrl = new URL(req.url);
      const afterParam = incomingUrl.searchParams.get('after');

      let query = supabaseAdmin
        .from('code_finder_messages')
        .select('id, enquiry_id, sender_type, message, created_at, reply_to_message_id')
        .eq('code_finder_user_id', authData.cfUser.id);

      if (afterParam) {
        // Incremental poll: ?after=timestamp,id
        const parts = afterParam.split(',');
        const afterTs = parts[0];
        const afterId = parts[1];
        
        if (afterId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(afterId)) {
          return createErrorResponse('Invalid cursor ID format', 400);
        }
        if (afterTs && isNaN(Date.parse(afterTs))) {
          return createErrorResponse('Invalid cursor timestamp format', 400);
        }
        
        if (afterId) {
          query = query.or(`created_at.gt.${afterTs},and(created_at.eq.${afterTs},id.gt.${afterId})`);
        } else if (afterTs) {
          query = query.gt('created_at', afterTs);
        }
        query = query.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(100);
      } else {
        // Initial load: get latest 100
        query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      }

      const { data: rawMessages, error: msgErr } = await query;

      if (msgErr) {
        console.error('Messages GET error:', msgErr);
        return createErrorResponse('Failed to fetch messages', 500);
      }

      const messages = afterParam ? rawMessages : rawMessages.reverse();

      return new Response(JSON.stringify({ messages }), {
        status: 200,
        headers: headers
      });
    }

    if (req.method === 'POST') {
      const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
      const keyHash = await hmacIpHash(rawIp, authData.cfUser.id);

      const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
        p_namespace: 'message',
        p_key_hash: keyHash,
        p_max_requests: 20,
        p_window_seconds: 60 // 20 messages per minute
      });

      if (limitErr || !limitData?.allowed) {
        return createErrorResponse('Too many messages. Please wait.', 429);
      }

      const payload = await req.json();
      const messageText = payload.message?.trim() || '';
      const enquiryId = payload.enquiry_id || null;
      const replyToMessageId = payload.reply_to_message_id || null;

      if (!messageText || messageText.length === 0 || messageText.length > 2000) {
        return createErrorResponse('Invalid message length', 400);
      }

      // Use the authenticated client so the RPC can access auth.uid()
      const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!SUPABASE_ANON_KEY) return createErrorResponse('Server misconfiguration', 500);

      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authData.accessToken}` } }
      });

      const { data: newMessage, error: insertErr } = await authClient.rpc('send_code_finder_message', {
        p_message: messageText,
        p_enquiry_id: enquiryId,
        p_reply_to_message_id: replyToMessageId
      });

      if (insertErr) {
        console.error('Messages POST error:', insertErr);
        return createErrorResponse('Failed to send message', 400);
      }

      return new Response(JSON.stringify({ message: newMessage }), {
        status: 200,
        headers: headers
      });
    }
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse('Internal Server Error', 502);
  }
}
