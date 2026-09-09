import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    // Get DB URL and ANON Key securely from Supabase Edge environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
    // Create direct client
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || supabaseAnonKey)

    const payload = await req.json()
    const requests: { code: string, quantity: number }[] = payload.requests || []

    if (!Array.isArray(requests) || requests.length === 0) {
      return new Response(JSON.stringify({ error: 'No requests provided' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } 
      })
    }

    if (requests.length > 25) {
       return new Response(JSON.stringify({ error: 'Max 25 codes per request' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } 
      })
    }

    // Rate Limiting Logic
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const today = new Date().toISOString().split('T')[0]
    
    // Increment or insert
    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('increment_laminea_rate_limit', {
      p_ip_address: ip,
      p_action_date: today,
      p_count: requests.length
    })

    if (limitErr) {
      console.error('Rate limit check failed:', limitErr)
    }

    // If over limit, deny (using 200 checks per day as standard)
    const currentLimit = limitData || 0
    if (currentLimit > 200) {
      return new Response(JSON.stringify({ error: 'Daily limit exceeded' }), { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } 
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
      .from('laminea_product_codes')
      .select('alternative_code, product_id, is_active')
      .in('alternative_code', uniqueCodes)
      .eq('is_active', true)

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

    // Map alternative_code to actual stock
    const codeToStock: Record<string, number> = {}
    mappings.forEach(m => {
       codeToStock[m.alternative_code] = stockMap[m.product_id] || 0
    })

    const results = []

    for (const code of uniqueCodes) {
      const reqQty = aggregatedReqs[code]
      
      if (reqQty < 0) {
        results.push({ code, requestedQuantity: 'Invalid', status: 'INVALID QUANTITY' })
        continue
      }
      
      if (codeToStock[code] === undefined) {
         results.push({ code, requestedQuantity: reqQty, status: 'CODE NOT FOUND' })
         continue
      }
      
      const actualStock = codeToStock[code]
      
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } 
    })
  }
})
