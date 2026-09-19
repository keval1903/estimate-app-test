import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
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
      .select('id, is_active')
      .eq('auth_user_id', user.id)
      .single()

    if (cfUserErr || !cfUser || !cfUser.is_active) {
      return new Response('Account inactive or not found', { status: 403, headers: corsHeaders })
    }

    if (req.method === 'GET') {
      const { data: enquiries, error: eqErr } = await supabaseAdmin
        .from('code_finder_enquiries')
        .select(`
          id, enquiry_number, status, client_note, checked_at, created_at,
          code_finder_enquiry_items (
            id, alternative_code_snapshot, requested_quantity, availability_status
          )
        `)
        .eq('code_finder_user_id', cfUser.id)
        .order('created_at', { ascending: false })

      if (eqErr) throw eqErr

      return new Response(JSON.stringify({ enquiries }), {
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' },
      })
    } 
    
    if (req.method === 'POST') {
      const payload = await req.json()
      const requests = payload.requests || []
      const clientNote = payload.client_note || null

      if (!Array.isArray(requests) || requests.length === 0) {
        return new Response(JSON.stringify({ error: 'No items provided' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      // 1. Fresh stock check
      const aggregatedReqs: Record<string, number> = {}
      for (const r of requests) {
        if (!r.code || typeof r.code !== 'string') continue
        const code = r.code.trim().toUpperCase()
        const qty = Number(r.quantity)
        if (isNaN(qty) || qty <= 0) continue
        aggregatedReqs[code] = (aggregatedReqs[code] || 0) + qty
      }

      const uniqueCodes = Object.keys(aggregatedReqs)
      if (uniqueCodes.length === 0) {
        return new Response(JSON.stringify({ error: 'Invalid items' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      const { data: mappings, error: mappingErr } = await supabaseAdmin.rpc('search_laminea_availability_codes', { search_codes: uniqueCodes })
      if (mappingErr) throw mappingErr

      const productIds = mappings.map((m: any) => m.product_id)
      let stockMap: Record<string, number> = {}
      
      if (productIds.length > 0) {
        const { data: products, error: productErr } = await supabaseAdmin.from('products').select('id, stock').in('id', productIds)
        if (productErr) throw productErr
        products.forEach(p => stockMap[p.id] = Number(p.stock) || 0)
      }

      const codeToStock: Record<string, number> = {}
      mappings.forEach((m: any) => {
         const norm = m.alternative_code.replace(/\s+/g, '').toUpperCase()
         codeToStock[norm] = stockMap[m.product_id] || 0
      })

      const checkedAt = new Date().toISOString()
      const itemsToInsert = []

      for (const code of uniqueCodes) {
        const reqQty = aggregatedReqs[code]
        const normCode = code.replace(/\s+/g, '').toUpperCase()
        
        let status = 'PLEASE_CONFIRM'
        if (codeToStock[normCode] === undefined) {
           status = 'CODE_NOT_FOUND'
        } else {
           const actualStock = codeToStock[normCode]
           if (reqQty >= 1 && reqQty <= 10 && actualStock >= reqQty) {
             status = 'AVAILABLE'
           }
        }
        
        itemsToInsert.push({
          alternative_code_snapshot: code,
          requested_quantity: reqQty,
          availability_status: status,
          checked_at: checkedAt
        })
      }

      // 2. Insert Enquiry Atomically
      const { data: newEnquiry, error: insertErr } = await supabaseAdmin
        .from('code_finder_enquiries')
        .insert({
          code_finder_user_id: cfUser.id,
          status: 'NEW',
          client_note: clientNote,
          checked_at: checkedAt
        })
        .select('id, enquiry_number')
        .single()

      if (insertErr) throw insertErr

      const itemsWithEnquiryId = itemsToInsert.map(item => ({
        ...item,
        enquiry_id: newEnquiry.id
      }))

      const { error: itemsErr } = await supabaseAdmin.from('code_finder_enquiry_items').insert(itemsWithEnquiryId)
      if (itemsErr) {
        // Rollback header if items fail
        await supabaseAdmin.from('code_finder_enquiries').delete().eq('id', newEnquiry.id)
        throw itemsErr
      }

      return new Response(JSON.stringify({
        success: true,
        enquiry_number: newEnquiry.enquiry_number,
        checked_at: checkedAt,
        items: itemsToInsert
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
