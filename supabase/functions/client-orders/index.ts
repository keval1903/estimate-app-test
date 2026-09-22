import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const CODE_FINDER_ORIGIN = Deno.env.get('CODE_FINDER_ORIGIN') || 'https://code-finder-five.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': CODE_FINDER_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-code-finder-secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    if (req.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
    }

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

    // Get confirmed enquiries without leaking internal estimate data
    const { data: enquiries, error: eqErr } = await supabaseAdmin
      .from('code_finder_enquiries')
      .select(`
        id, enquiry_number, status, checked_at, created_at, updated_at, confirmed_at,
        code_finder_enquiry_items (
          id, alternative_code_snapshot, requested_quantity
        ),
        code_finder_proposals (
          id, response, superseded_at,
          code_finder_proposal_items (
            enquiry_item_id, proposed_quantity
          )
        )
      `)
      .eq('code_finder_user_id', cfUser.id)
      .eq('status', 'ORDER_PLACED')
      .order('created_at', { ascending: false })

    if (eqErr) throw eqErr

    // Build response — only expose safe fields, never internal codes/rates/stock
    const orders = (enquiries || []).map((eq: any) => {
      const acceptedProposal = (eq.code_finder_proposals || []).find((p: any) => p.response === 'ACCEPTED' && p.superseded_at === null);

      return {
        id: eq.id,
        enquiry_number: eq.enquiry_number,
        status: eq.status,
        checked_at: eq.checked_at,
        created_at: eq.created_at,
        confirmed_at: eq.confirmed_at,
        code_finder_enquiry_items: (eq.code_finder_enquiry_items || []).map((item: any) => {
          let qty = item.requested_quantity;
          if (acceptedProposal) {
            const pItem = (acceptedProposal.code_finder_proposal_items || []).find((pi: any) => pi.enquiry_item_id === item.id);
            if (pItem) {
              qty = pItem.proposed_quantity;
            }
          }
          return {
            alternative_code: item.alternative_code_snapshot,
            quantity: qty
          };
        })
      }
    })

    return new Response(JSON.stringify({ orders }), {
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
