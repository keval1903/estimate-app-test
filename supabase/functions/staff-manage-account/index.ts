import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('authorization')
    
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    
    if (authErr || !user) {
      return new Response('Unauthorized token', { status: 401, headers: corsHeaders })
    }

    // Verify admin role
    const { data: adminCheck } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('id', user.id)
      .eq('is_active', true)
      .eq('role', 'ADMIN')
      .single()

    if (!adminCheck) {
      return new Response('Forbidden: Admin only', { status: 403, headers: corsHeaders })
    }

    const payload = await req.json()
    const { action, username, password, client_name, contact_person, mobile, laminea_client_id } = payload

    if (action === 'CREATE') {
      const email = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@codefinder.local`
      
      const { data: authData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { account_type: 'code_finder' }
      })

      if (createErr) throw createErr

      const { error: profileErr } = await supabaseAdmin
        .from('code_finder_users')
        .insert({
          auth_user_id: authData.user.id,
          username: username.trim(),
          client_name: client_name.trim(),
          contact_person: contact_person ? contact_person.trim() : null,
          mobile: mobile ? mobile.trim() : null,
          laminea_client_id: laminea_client_id || null,
          must_change_password: true
        })

      if (profileErr) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        throw profileErr
      }

      return new Response(JSON.stringify({ success: true, user_id: authData.user.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'RESET_PASSWORD') {
      const { user_id, new_password } = payload
      if (!user_id || !new_password) throw new Error('Missing user_id or new_password')

      const { data: cfUser, error: cfErr } = await supabaseAdmin
        .from('code_finder_users')
        .select('auth_user_id')
        .eq('id', user_id)
        .single()
      
      if (cfErr || !cfUser) throw new Error('User not found')

      const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(
        cfUser.auth_user_id,
        { password: new_password }
      )
      
      if (resetErr) throw resetErr

      await supabaseAdmin.from('code_finder_users').update({ must_change_password: true }).eq('id', user_id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Invalid action', { status: 400, headers: corsHeaders })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
