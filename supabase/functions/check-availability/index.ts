import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
    }

    // Secret validation
    const secret = req.headers.get('x-code-finder-secret')
    if (!secret || secret !== Deno.env.get('CODE_FINDER_PROXY_SECRET')) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set')
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const payload = await req.json()
    const requests: { code: string, quantity: number }[] = payload.requests || []

    if (!Array.isArray(requests) || requests.length === 0) {
      return new Response(JSON.stringify({ error: 'No requests provided' }), {
        status: 400,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (requests.length > 25) {
      return new Response(JSON.stringify({ error: 'Max 25 codes per request' }), {
        status: 400,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Rate Limiting Logic — fail closed: deny if the check itself errors
    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || req.headers.get('x-real-ip')
      || 'unknown'
    const ipBytes = new TextEncoder().encode(rawIp)
    const hashBuffer = await crypto.subtle.digest('SHA-256', ipBytes)
    const ipHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_and_update_rate_limit', {
      p_ip_hash: ipHash
    })

    if (limitErr) {
      console.error('Rate limit check failed:', limitErr)
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 429,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!limitData?.allowed) {
      return new Response(JSON.stringify({ error: limitData?.reason || 'Rate limit exceeded' }), {
        status: 429,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Combine duplicate codes in the request
    const aggregatedReqs: Record<string, number> = {}
    for (const r of requests) {
      if (!r.code || typeof r.code !== 'string') continue
      const code = r.code.trim().toUpperCase()
      const qty = Number(r.quantity)
      if (isNaN(qty) || qty <= 0) {
        aggregatedReqs[code] = (aggregatedReqs[code] || 0) - 1000 // Flag as invalid
      } else {
        aggregatedReqs[code] = (aggregatedReqs[code] || 0) + qty
      }
    }

    const uniqueCodes = Object.keys(aggregatedReqs)
    
    // Fetch codes
    const { data: mappings, error: mappingErr } = await supabaseAdmin
      .rpc('search_laminea_availability_codes', { search_codes: uniqueCodes })

    if (mappingErr) throw mappingErr

    const productIds = mappings.map(m => m.product_id)
    let stockMap: Record<string, number> = {}
    
    if (productIds.length > 0) {
      const { data: products, error: productErr } = await supabaseAdmin
        .from('products')
        .select('id, stock')
        .in('id', productIds)
      
      if (productErr) throw productErr
      products.forEach(p => {
        stockMap[p.id] = Number(p.stock) || 0
      })
    }

    // Map alternative_code to actual stock using normalized keys
    const codeToStock: Record<string, number> = {}
    mappings.forEach((m: any) => {
       const norm = m.alternative_code.replace(/\s+/g, '').toUpperCase()
       codeToStock[norm] = stockMap[m.product_id] || 0
    })

    const results = []

    for (const code of uniqueCodes) {
      const reqQty = aggregatedReqs[code]
      
      const normCode = code.replace(/\s+/g, '').toUpperCase()
      
      if (reqQty < 0) {
        results.push({ code, requestedQuantity: 'Invalid', status: 'INVALID QUANTITY' })
        continue
      }
      
      if (codeToStock[normCode] === undefined) {
         results.push({ code, requestedQuantity: reqQty, status: 'CODE NOT FOUND' })
         continue
      }
      
      const actualStock = codeToStock[normCode]
      
      let status = 'PLEASE CONFIRM WITH US'
      if (reqQty >= 1 && reqQty <= 10 && actualStock >= reqQty) {
        status = 'AVAILABLE'
      }
      
      results.push({
        code,
        requestedQuantity: reqQty,
        status
      })
    }

    return new Response(JSON.stringify({
      results,
      checkedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
    })
  }
})
