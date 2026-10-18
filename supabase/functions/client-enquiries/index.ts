import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const CODE_FINDER_ORIGIN = Deno.env.get('CODE_FINDER_ORIGIN') || 'https://code-finder-five.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': CODE_FINDER_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

async function hmacIpHash(rawIp: string, userId: string): Promise<string> {
  const secret = Deno.env.get('RATE_LIMIT_HMAC_SECRET')
  if (!secret) throw new Error('Server misconfiguration: RATE_LIMIT_HMAC_SECRET missing')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const data = new TextEncoder().encode(`${userId}:${rawIp}`)
  const signature = await crypto.subtle.sign('HMAC', key, data)

  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const secret = req.headers.get('x-code-finder-secret')
    if (!secret || secret !== Deno.env.get('CODE_FINDER_PROXY_SECRET')) {
      return new Response('Unauthorized secret', { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response('Missing authorization header', { status: 401, headers: corsHeaders })
    }

    const token = authHeader.replace('Bearer ', '')
    
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: { user }, error: authErr } = await authClient.auth.getUser(token)
    
    if (authErr || !user) {
      return new Response('Unauthorized token', { status: 401, headers: corsHeaders })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const { data: cfUser, error: cfUserErr } = await supabaseAdmin
      .from('code_finder_users')
      .select('id, is_active, must_change_password')
      .eq('auth_user_id', user.id)
      .single()

    if (cfUserErr || !cfUser || !cfUser.is_active) {
      return new Response('Account inactive or not found', { status: 403, headers: corsHeaders })
    }

    if (cfUser.must_change_password) {
      return new Response(JSON.stringify({ error: 'Password change required' }), {
        status: 403,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (req.method === 'GET') {
      const { data: enquiries, error: eqErr } = await supabaseAdmin
        .from('code_finder_enquiries')
        .select(`
          id, enquiry_number, status, client_note, checked_at, created_at, ordered_by,
          code_finder_enquiry_items (
            id, alternative_code_snapshot, requested_quantity, availability_status
          ),
          code_finder_proposals (
            id, revision, proposal_type, staff_note, submitted_at, response, responded_at,
            code_finder_proposal_items (
              enquiry_item_id, proposed_quantity, item_note
            )
          )
        `)
        .eq('code_finder_user_id', cfUser.id)
        .in('status', ['NEW', 'AWAITING_CLIENT', 'READY_TO_ORDER'])
        .order('created_at', { ascending: false })

      if (eqErr) throw eqErr

      const safeEnquiries = (enquiries || []).map((enq: any) => ({
        id: enq.id,
        enquiry_number: enq.enquiry_number,
        status: enq.status,
        client_note: enq.client_note,
        checked_at: enq.checked_at,
        created_at: enq.created_at,
        ordered_by: enq.ordered_by,
        code_finder_enquiry_items: (enq.code_finder_enquiry_items || []).map((item: any) => ({
          id: item.id,
          alternative_code_snapshot: item.alternative_code_snapshot,
          requested_quantity: item.requested_quantity,
          availability_status: item.availability_status
        })),
        code_finder_proposals: (enq.code_finder_proposals || []).map((prop: any) => ({
          id: prop.id,
          revision: prop.revision,
          proposal_type: prop.proposal_type,
          staff_note: prop.staff_note,
          submitted_at: prop.submitted_at,
          response: prop.response,
          responded_at: prop.responded_at,
          code_finder_proposal_items: (prop.code_finder_proposal_items || []).map((pi: any) => ({
            enquiry_item_id: pi.enquiry_item_id,
            proposed_quantity: pi.proposed_quantity,
            item_note: pi.item_note
          }))
        }))
      }))

      return new Response(JSON.stringify({ enquiries: safeEnquiries }), {
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' },
      })
    } 
    
    if (req.method === 'POST') {
      // Rate limiting for enquiry submission
      const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown'
      const keyHash = await hmacIpHash(rawIp, cfUser.id)

      const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
        p_namespace: 'enquiry',
        p_key_hash: keyHash,
        p_max_requests: 10,
        p_window_seconds: 300  // 10 enquiries per 5 minutes
      })

      if (limitErr) {
        console.error('Rate limit check failed:', limitErr)
        return new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 429,
          headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!limitData?.allowed) {
        return new Response(JSON.stringify({ error: 'Too many submissions. Please wait.' }), {
          status: 429,
          headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
        })
      }

      const payload = await req.json()
      const requests = payload.requests || []
      const clientNote = payload.client_note || null
      const idempotencyKey = payload.idempotency_key || null
      const orderedBy = payload.ordered_by || null

      if (!Array.isArray(requests) || requests.length === 0) {
        return new Response(JSON.stringify({ error: 'No items provided' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      if (requests.length > 25) {
        return new Response(JSON.stringify({ error: 'Maximum 25 items per enquiry' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      const sanitizedRequests = requests.map((r: any) => ({
        code: typeof r?.code === 'string' ? r.code : String(r?.code ?? ''),
        quantity: r?.quantity
      }))

      // Group-scoped stock check using verified customer ID
      const { data: stockResults, error: stockErr } = await supabaseAdmin.rpc('check_laminea_stock_availability', {
        p_requests: sanitizedRequests,
        p_cf_user_id: cfUser.id
      })
      if (stockErr) throw stockErr

      const checkedAt = new Date().toISOString()
      const statusMap: Record<string, string> = {
        'AVAILABLE': 'AVAILABLE',
        'PLEASE CONFIRM WITH US': 'PLEASE_CONFIRM',
        'CODE NOT FOUND': 'CODE_NOT_FOUND',
        'INVALID QUANTITY': 'PLEASE_CONFIRM'
      }

      const itemsForRpc = (stockResults || []).map((r: any) => ({
        alternative_code_snapshot: r.code,
        requested_quantity: r.requestedQuantity === 'Invalid' ? 0 : Number(r.requestedQuantity),
        availability_status: statusMap[r.status] || r.status,
        checked_at: checkedAt
      }))

      // Atomic creation via RPC with idempotency (cf8_capture_mapping populates group/prefix/mapping/product snapshots)
      const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('create_code_finder_enquiry', {
        p_user_id: cfUser.id,
        p_items: itemsForRpc,
        p_client_note: clientNote,
        p_checked_at: checkedAt,
        p_idempotency_key: idempotencyKey,
        p_ordered_by: orderedBy
      })

      if (rpcErr) throw rpcErr

      return new Response(JSON.stringify({
        success: true,
        enquiry_number: rpcResult.enquiry_number,
        duplicate: rpcResult.duplicate || false,
        checked_at: checkedAt,
        items: itemsForRpc.map((item: any) => ({
          alternative_code_snapshot: item.alternative_code_snapshot,
          requested_quantity: item.requested_quantity,
          availability_status: item.availability_status
        }))
      }), {
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
    })
  }
})
