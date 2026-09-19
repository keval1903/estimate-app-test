import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const CODE_FINDER_ORIGIN = Deno.env.get('CODE_FINDER_ORIGIN') || 'https://code-finder-five.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': CODE_FINDER_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const noCacheHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

async function hmacIpHash(rawIp: string, userId: string): Promise<string> {
  const secret = Deno.env.get('RATE_LIMIT_HMAC_SECRET') || 'default-hmac-key'
  const data = new TextEncoder().encode(`${rawIp}:${secret}`)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  const ipPart = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  // Include user ID in hash so rate limiting is per-user+IP
  const combined = new TextEncoder().encode(`${userId}:${ipPart}`)
  const finalBuf = await crypto.subtle.digest('SHA-256', combined)
  return Array.from(new Uint8Array(finalBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    
    if (!serviceRoleKey || !anonKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not set')
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Token validation
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

    // Verify Code Finder user is active
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

    // Rate Limiting — namespaced, per user+IP
    const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || req.headers.get('x-real-ip')
      || 'unknown'
    const keyHash = await hmacIpHash(rawIp, cfUser.id)

    const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
      p_namespace: 'stock',
      p_key_hash: keyHash,
      p_max_requests: 30,
      p_window_seconds: 60
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

    // Phase 2: Normalize codes BEFORE aggregation to combine space variants
    const aggregatedReqs: Record<string, number> = {}
    const displayCodeMap: Record<string, string> = {} // normalized → first raw input

    for (const r of requests) {
      if (!r.code || typeof r.code !== 'string') continue
      const normalized = r.code.trim().replace(/\s+/g, '').toUpperCase()
      if (!normalized) continue
      
      const qty = Number(r.quantity)
      
      // Keep the first raw code as the display code
      if (!(normalized in displayCodeMap)) {
        displayCodeMap[normalized] = r.code.trim().toUpperCase()
      }
      
      if (isNaN(qty) || qty <= 0) {
        aggregatedReqs[normalized] = (aggregatedReqs[normalized] || 0) - 1000 // Flag as invalid
      } else {
        aggregatedReqs[normalized] = (aggregatedReqs[normalized] || 0) + qty
      }
    }

    const uniqueNormalized = Object.keys(aggregatedReqs)
    
    // Fetch codes — pass normalized codes (spaces already stripped)
    const { data: mappings, error: mappingErr } = await supabaseAdmin
      .rpc('search_laminea_availability_codes', { search_codes: uniqueNormalized })

    if (mappingErr) throw mappingErr

    const productIds = mappings.map((m: any) => m.product_id)
    let stockMap: Record<string, number> = {}
    
    if (productIds.length > 0) {
      const { data: products, error: productErr } = await supabaseAdmin
        .from('products')
        .select('id, stock')
        .in('id', productIds)
      
      if (productErr) throw productErr
      products.forEach((p: any) => {
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

    for (const normCode of uniqueNormalized) {
      const reqQty = aggregatedReqs[normCode]
      const displayCode = displayCodeMap[normCode] || normCode
      
      if (reqQty < 0) {
        results.push({ code: displayCode, requestedQuantity: 'Invalid', status: 'INVALID QUANTITY' })
        continue
      }
      
      if (codeToStock[normCode] === undefined) {
         results.push({ code: displayCode, requestedQuantity: reqQty, status: 'CODE NOT FOUND' })
         continue
      }
      
      const actualStock = codeToStock[normCode]
      
      let status = 'PLEASE CONFIRM WITH US'
      if (reqQty >= 1 && reqQty <= 10 && actualStock >= reqQty) {
        status = 'AVAILABLE'
      }
      
      results.push({
        code: displayCode,
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
