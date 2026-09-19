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
  const secret = Deno.env.get('RATE_LIMIT_HMAC_SECRET') || 'default-hmac-key'
  const data = new TextEncoder().encode(`${rawIp}:${secret}`)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  const ipPart = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  const combined = new TextEncoder().encode(`${userId}:${ipPart}`)
  const finalBuf = await crypto.subtle.digest('SHA-256', combined)
  return Array.from(new Uint8Array(finalBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
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
      // Support incremental polling: ?after=<ISO timestamp>
      const url = new URL(req.url)
      const afterParam = url.searchParams.get('after')

      let query = supabaseAdmin
        .from('code_finder_messages')
        .select('id, enquiry_id, sender_type, message, created_at')
        .eq('code_finder_user_id', cfUser.id)
        .order('created_at', { ascending: true })

      if (afterParam) {
        // Incremental poll: only messages after the given timestamp
        query = query.gt('created_at', afterParam)
      }

      const { data: messages, error: msgErr } = await query

      if (msgErr) throw msgErr

      return new Response(JSON.stringify({ messages }), {
        headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' },
      })
    }
    
    if (req.method === 'POST') {
      // Rate limiting for messages
      const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown'
      const keyHash = await hmacIpHash(rawIp, cfUser.id)

      const { data: limitData, error: limitErr } = await supabaseAdmin.rpc('check_rate_limit_v2', {
        p_namespace: 'message',
        p_key_hash: keyHash,
        p_max_requests: 20,
        p_window_seconds: 60  // 20 messages per minute
      })

      if (limitErr) {
        console.error('Rate limit check failed:', limitErr)
        return new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 429,
          headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!limitData?.allowed) {
        return new Response(JSON.stringify({ error: 'Too many messages. Please wait.' }), {
          status: 429,
          headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' }
        })
      }

      const payload = await req.json()
      const messageText = payload.message?.trim() || ''
      const enquiryId = payload.enquiry_id || null

      if (!messageText || messageText.length === 0 || messageText.length > 2000) {
        return new Response(JSON.stringify({ error: 'Invalid message length' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
      }

      if (enquiryId) {
        // Verify enquiry belongs to user
        const { data: verifyEq, error: eqErr } = await supabaseAdmin
          .from('code_finder_enquiries')
          .select('id')
          .eq('id', enquiryId)
          .eq('code_finder_user_id', cfUser.id)
          .single()
        
        if (eqErr || !verifyEq) {
          return new Response(JSON.stringify({ error: 'Invalid enquiry ID' }), { status: 400, headers: { ...corsHeaders, ...noCacheHeaders, 'Content-Type': 'application/json' } })
        }
      }

      const { data: newMessage, error: insertErr } = await supabaseAdmin
        .from('code_finder_messages')
        .insert({
          code_finder_user_id: cfUser.id,
          enquiry_id: enquiryId,
          sender_type: 'CLIENT',
          sender_auth_user_id: user.id,
          message: messageText
        })
        .select('id, enquiry_id, sender_type, message, created_at')
        .single()

      if (insertErr) throw insertErr

      return new Response(JSON.stringify({ message: newMessage }), {
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
