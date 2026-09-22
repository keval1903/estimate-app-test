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
          id, enquiry_number, status, client_note, checked_at, created_at,
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

      return new Response(JSON.stringify({ enquiries }), {
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

      if (!Array.isArray(requests) || requests.length === 0) {
        return new Response(JSON.stringify({ error: 'No items provided' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      if (requests.length > 25) {
        return new Response(JSON.stringify({ error: 'Maximum 25 items per enquiry' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      // Phase 2: Normalize codes BEFORE aggregation
      const aggregatedReqs: Record<string, number> = {}
      const displayCodeMap: Record<string, string> = {}

      for (const r of requests) {
        if (!r.code || typeof r.code !== 'string') continue
        const normalized = r.code.trim().replace(/\s+/g, '').toUpperCase()
        if (!normalized) continue
        const qty = Number(r.quantity)
        if (isNaN(qty) || qty <= 0) continue
        
        if (!(normalized in displayCodeMap)) {
          displayCodeMap[normalized] = r.code.trim().toUpperCase()
        }
        aggregatedReqs[normalized] = (aggregatedReqs[normalized] || 0) + qty
      }

      const uniqueCodes = Object.keys(aggregatedReqs)
      if (uniqueCodes.length === 0) {
        return new Response(JSON.stringify({ error: 'Invalid items' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      // Fresh stock check
      const { data: mappings, error: mappingErr } = await supabaseAdmin.rpc('search_laminea_availability_codes', { search_codes: uniqueCodes })
      if (mappingErr) throw mappingErr

      const productIds = mappings.map((m: any) => m.product_id)
      let stockMap: Record<string, number> = {}
      
      if (productIds.length > 0) {
        const { data: products, error: productErr } = await supabaseAdmin.from('products').select('id, stock').in('id', productIds)
        if (productErr) throw productErr
        products.forEach((p: any) => stockMap[p.id] = Number(p.stock) || 0)
      }

      const codeToStock: Record<string, number> = {}
      const codeToProductId: Record<string, string> = {}
      
      mappings.forEach((m: any) => {
         const norm = m.alternative_code.replace(/\s+/g, '').toUpperCase()
         codeToStock[norm] = stockMap[m.product_id] || 0
         codeToProductId[norm] = m.product_id
      })

      const checkedAt = new Date().toISOString()
      const itemsForRpc = []

      for (const normCode of uniqueCodes) {
        const reqQty = aggregatedReqs[normCode]
        const displayCode = displayCodeMap[normCode] || normCode
        
        let status = 'PLEASE_CONFIRM'
        if (codeToStock[normCode] === undefined) {
           status = 'CODE_NOT_FOUND'
        } else {
           const actualStock = codeToStock[normCode]
           if (reqQty >= 1 && reqQty <= 10 && actualStock >= reqQty) {
             status = 'AVAILABLE'
           }
        }
        
        itemsForRpc.push({
          alternative_code_snapshot: displayCode,
          requested_quantity: reqQty,
          availability_status: status,
          checked_at: checkedAt,
          product_id_snapshot: codeToProductId[normCode] || null,
          product_code_snapshot: displayCode,
          mapping_revision_at: checkedAt
        })
      }

      // Phase 3: Atomic creation via RPC with idempotency
      const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('create_code_finder_enquiry', {
        p_user_id: cfUser.id,
        p_items: itemsForRpc,
        p_client_note: clientNote,
        p_checked_at: checkedAt,
        p_idempotency_key: idempotencyKey
      })

      if (rpcErr) throw rpcErr

      return new Response(JSON.stringify({
        success: true,
        enquiry_number: rpcResult.enquiry_number,
        duplicate: rpcResult.duplicate || false,
        checked_at: checkedAt,
        items: itemsForRpc
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
