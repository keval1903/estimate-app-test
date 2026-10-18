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
    if (!SUPABASE_URL) {
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
        console.error('Order Error:', error);
        return createErrorResponse('Failed to place order', 400);
      }

      const safeOrder = orderData
        ? {
            success: Boolean(orderData.success),
            enquiry_id: orderData.enquiry_id,
            status: orderData.status
          }
        : null;

      return new Response(JSON.stringify({ success: true, order: safeOrder }), {
        status: 200,
        headers: headers
      });
    }

    if (req.method === 'GET') {
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!SUPABASE_SERVICE_ROLE_KEY) {
        return createErrorResponse('Server misconfiguration: missing service key', 500);
      }
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

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
          order_placed_at,
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
        .eq('status', 'ORDER_PLACED')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Orders GET DB error:', error);
        return createErrorResponse('Failed to fetch orders from database', 500);
      }
      
      // Apply accepted proposal quantities and enforce explicit allowlist
      const processedOrders = (data || []).map(order => {
        const acceptedProposal = order.code_finder_proposals?.find(p => p.response === 'ACCEPTED' && p.superseded_at === null);
        const proposedQtys = {};
        if (acceptedProposal && acceptedProposal.code_finder_proposal_items) {
          for (const pi of acceptedProposal.code_finder_proposal_items) {
            proposedQtys[pi.enquiry_item_id] = pi.proposed_quantity;
          }
        }

        return {
          id: order.id,
          enquiry_number: order.enquiry_number,
          status: order.status,
          client_note: order.client_note,
          checked_at: order.checked_at,
          created_at: order.created_at,
          ordered_by: order.ordered_by,
          order_placed_at: order.order_placed_at,
          code_finder_enquiry_items: (order.code_finder_enquiry_items || []).map(item => ({
            id: item.id,
            alternative_code_snapshot: item.alternative_code_snapshot,
            requested_quantity: proposedQtys[item.id] !== undefined ? proposedQtys[item.id] : item.requested_quantity,
            availability_status: item.availability_status
          })),
          code_finder_proposals: (order.code_finder_proposals || []).map(prop => ({
            id: prop.id,
            revision: prop.revision,
            proposal_type: prop.proposal_type,
            staff_note: prop.staff_note,
            submitted_at: prop.submitted_at,
            superseded_at: prop.superseded_at,
            response: prop.response,
            responded_at: prop.responded_at,
            code_finder_proposal_items: (prop.code_finder_proposal_items || []).map(pi => ({
              enquiry_item_id: pi.enquiry_item_id,
              proposed_quantity: pi.proposed_quantity,
              item_note: pi.item_note
            }))
          }))
        };
      });
      
      const hasMore = count > to + 1;

      return new Response(JSON.stringify({ orders: processedOrders, hasMore, page }), {
        status: 200,
        headers: headers
      });
    }
  } catch (err) {
    console.error('Proxy Error:', err);
    return createErrorResponse(`Failed to communicate with orders service: ${err.message}`, 502);
  }
}
