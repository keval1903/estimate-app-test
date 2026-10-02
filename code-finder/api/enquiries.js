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
      const pageStr = incomingUrl.searchParams.get('page');
      let page = parseInt(pageStr, 10);
      if (isNaN(page) || page < 1) page = 1;
      
      const limit = 20;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { data, error, count } = await supabaseAdmin
        .from('code_finder_enquiries')
        .select(`
          id,
          enquiry_number,
          status,
          client_note,
          checked_at,
          created_at,
          ordered_by,
          code_finder_enquiry_items (
            id,
            alternative_code_snapshot,
            requested_quantity,
            availability_status
          ),
          code_finder_proposals (
            id,
            revision,
            proposal_type,
            staff_note,
            submitted_at,
            superseded_at,
            response,
            responded_at,
            code_finder_proposal_items (
              enquiry_item_id,
              proposed_quantity,
              item_note
            )
          )
        `, { count: 'exact' })
        .eq('code_finder_user_id', authData.cfUser.id)
        .in('status', ['NEW', 'AWAITING_CLIENT', 'READY_TO_ORDER'])
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Enquiries GET error:', error);
        return createErrorResponse('Failed to fetch enquiries', 500);
      }
      
      const hasMore = count > to + 1;

      return new Response(JSON.stringify({ enquiries: data || [], hasMore, page }), {
        status: 200,
        headers: headers
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { requests = [], client_note, checked_at, idempotency_key, ordered_by } = body;
      
      if (!Array.isArray(requests) || requests.length === 0) {
        return createErrorResponse('No items provided', 400);
      }
      if (requests.length > 25) {
        return createErrorResponse('Max 25 codes per request', 400);
      }

      const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
      const keyHash = await hmacIpHash(rawIp, authData.cfUser.id);
      
      const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
        p_namespace: 'enquiry',
        p_key_hash: keyHash,
        p_max_requests: 10,
        p_window_seconds: 300 // 10 enquiries per 5 minutes
      });

      if (limitErr) {
        console.error('Rate limit check failed:', limitErr);
        return createErrorResponse('Service unavailable', 429);
      }
      if (!limitData?.allowed) {
        return createErrorResponse('Too many submissions. Please wait.', 429);
      }

      // Check stock using the unified RPC
      const { data: stockResults, error: stockErr } = await supabaseAdmin.rpc('check_laminea_stock_availability', {
        p_requests: requests
      });

      if (stockErr) {
        console.error('Stock RPC Error:', stockErr);
        return createErrorResponse('Failed to check availability', 500);
      }

      // Format items for create_code_finder_enquiry
      // Note: The cf8_capture_mapping trigger automatically fills in product_id_snapshot
      const checkedAt = checked_at || new Date().toISOString();
      const itemsForRpc = stockResults.map(r => ({
        alternative_code_snapshot: r.code,
        requested_quantity: r.requestedQuantity === 'Invalid' ? 0 : Number(r.requestedQuantity),
        availability_status: r.status,
        checked_at: checkedAt
      }));

      // Create enquiry
      const { data: enquiryData, error: createErr } = await supabaseAdmin.rpc('create_code_finder_enquiry', {
        p_user_id: authData.cfUser.id,
        p_items: itemsForRpc,
        p_client_note: client_note || null,
        p_checked_at: checkedAt,
        p_idempotency_key: idempotency_key || null,
        p_ordered_by: ordered_by || null
      });

      if (createErr) {
        console.error('Enquiry Create Error:', createErr);
        return createErrorResponse(createErr.message, 400);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        enquiry_number: enquiryData.enquiry_number,
        duplicate: enquiryData.duplicate || false,
        checked_at: checkedAt,
        items: itemsForRpc
      }), {
        status: 200,
        headers: headers
      });
    }
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse('Internal Server Error', 502);
  }
}
