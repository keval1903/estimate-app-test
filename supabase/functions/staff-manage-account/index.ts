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

    // Verify active staff or admin role
    const { data: staffCheck } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('id', user.id)
      .eq('is_active', true)
      .in('role', ['ADMIN', 'STAFF'])
      .single()

    if (!staffCheck) {
      return new Response('Forbidden: Active staff or admin required', { status: 403, headers: corsHeaders })
    }

    const payload = await req.json()
    const { action, username, password, client_name, contact_person, mobile, code_group_id, customer_prefix } = payload

    const normalizePrefix = (raw: unknown): string =>
      String(raw ?? '').trim().replace(/\s+/g, '').toUpperCase()

    const formatDbConstraintError = (err: any, prefixVal?: string): Error => {
      const msg = String(err?.message || err?.details || '')
      if (msg.includes('code_finder_users_normalized_prefix_idx') || msg.includes('normalized_prefix')) {
        return new Error(`Customer prefix "${prefixVal || ''}" is already assigned to another customer account.`)
      }
      if (msg.includes('code_finder_users_normalized_username_idx') || msg.includes('normalized_username') || msg.includes('code_finder_users_username_key')) {
        return new Error('Username is already assigned to another customer account.')
      }
      return err instanceof Error ? err : new Error(msg || 'Database operation failed')
    }

    if (action === 'CREATE') {
      if (!username || !password || !client_name) {
        throw new Error('Username, password, and client name are required.')
      }
      if (!code_group_id) {
        throw new Error('An alternative-code group is required when creating a Code Finder account.')
      }

      const normPrefix = normalizePrefix(customer_prefix)
      if (!normPrefix || !/^[A-Z0-9]{1,10}$/.test(normPrefix)) {
        throw new Error('Customer prefix/initials is required (1–10 letters or numbers, e.g., NJ).')
      }

      const normUsername = String(username).trim().replace(/\s+/g, '').toUpperCase()
      if (!normUsername) {
        throw new Error('Valid username is required.')
      }

      // Verify group exists and is active
      const { data: groupRow, error: groupErr } = await supabaseAdmin
        .from('laminea_code_groups')
        .select('id, name, is_active')
        .eq('id', code_group_id)
        .single()

      if (groupErr || !groupRow) {
        throw new Error('Selected alternative-code group does not exist.')
      }
      if (!groupRow.is_active) {
        throw new Error('Selected alternative-code group is inactive. Please choose an active group.')
      }

      // Pre-validate username and prefix uniqueness before creating auth user
      const { data: existingUsername } = await supabaseAdmin
        .from('code_finder_users')
        .select('id')
        .eq('normalized_username', normUsername)
        .maybeSingle()

      if (existingUsername) {
        throw new Error(`Username "${normUsername}" is already in use.`)
      }

      const { data: existingPrefix } = await supabaseAdmin
        .from('code_finder_users')
        .select('id, client_name')
        .eq('normalized_prefix', normPrefix)
        .maybeSingle()

      if (existingPrefix) {
        throw new Error(`Customer prefix "${normPrefix}" is already assigned to ${existingPrefix.client_name}.`)
      }

      const email = `${normUsername.toLowerCase().replace(/[^a-z0-9]/g, '')}@codefinder.local`
      const { link_existing_client_id, create_new_client } = payload

      let createdAuthUserId: string | null = null

      const { data: authData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { account_type: 'code_finder' }
      })

      if (createErr) {
        // Recover from an orphan @codefinder.local auth user left behind if a prior run failed mid-flight
        const errMsg = String(createErr.message || '').toLowerCase()
        if (errMsg.includes('already') || errMsg.includes('registered') || errMsg.includes('exists')) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
          const matchingAuthUser = listData?.users?.find(
            (u: any) => String(u.email || '').toLowerCase() === email
          )
          if (matchingAuthUser) {
            const [{ data: linkedCf }, { data: linkedStaff }] = await Promise.all([
              supabaseAdmin.from('code_finder_users').select('id').eq('auth_user_id', matchingAuthUser.id).maybeSingle(),
              supabaseAdmin.from('user_roles').select('id').eq('id', matchingAuthUser.id).maybeSingle()
            ])
            if (!linkedCf && !linkedStaff) {
              // Orphan auth user confirmed: clean it up and retry createUser cleanly
              await supabaseAdmin.auth.admin.deleteUser(matchingAuthUser.id)
              const { data: retryAuth, error: retryErr } = await supabaseAdmin.auth.admin.createUser({
                email: email,
                password: password,
                email_confirm: true,
                user_metadata: { account_type: 'code_finder' }
              })
              if (retryErr) throw retryErr
              createdAuthUserId = retryAuth.user.id
            } else {
              throw new Error(`Username "${normUsername}" is already registered.`)
            }
          } else {
            throw createErr
          }
        } else {
          throw createErr
        }
      } else {
        createdAuthUserId = authData.user.id
      }

      let cfUserId: string | null = null

      try {
        const { data: profileData, error: profileErr } = await supabaseAdmin
          .from('code_finder_users')
          .insert({
            auth_user_id: createdAuthUserId,
            username: username.trim(),
            client_name: client_name.trim(),
            contact_person: contact_person ? contact_person.trim() : null,
            mobile: mobile ? mobile.trim() : null,
            code_group_id: code_group_id,
            customer_prefix: normPrefix,
            must_change_password: true
          })
          .select('id')
          .single()

        if (profileErr) {
          throw formatDbConstraintError(profileErr, normPrefix)
        }

        cfUserId = profileData.id

        if (create_new_client) {
          const { error: rpcErr } = await supabaseAdmin.rpc('create_and_link_laminea_client', {
            p_cf_user_id: cfUserId,
            p_client_name: client_name.trim(),
            p_mobile: mobile ? mobile.trim() : null,
            p_contact_person: contact_person ? contact_person.trim() : null
          })
          if (rpcErr) throw rpcErr
        } else if (link_existing_client_id) {
          const { error: rpcErr } = await supabaseAdmin.rpc('link_code_finder_client', {
            p_cf_user_id: cfUserId,
            p_client_id: link_existing_client_id
          })
          if (rpcErr) throw rpcErr
        }
      } catch (setupErr) {
        // Always clean up both code_finder_users and auth.users to prevent orphan accounts
        if (cfUserId) {
          await supabaseAdmin.from('code_finder_users').delete().eq('id', cfUserId)
        }
        if (createdAuthUserId) {
          const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId)
          if (delErr) {
            console.error('First attempt to clean up orphan auth user failed, retrying:', delErr)
            await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId)
          }
        }
        throw setupErr
      }

      return new Response(JSON.stringify({
        success: true,
        user_id: createdAuthUserId,
        cf_user_id: cfUserId,
        code_group_id,
        customer_prefix: normPrefix
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'UPDATE') {
      const { user_id, client_name, contact_person, mobile, is_active, code_group_id, customer_prefix } = payload
      if (!user_id) throw new Error('Missing user_id')

      const { data: currentCfUser, error: currentErr } = await supabaseAdmin
        .from('code_finder_users')
        .select('id, code_group_id, customer_prefix')
        .eq('id', user_id)
        .single()

      if (currentErr || !currentCfUser) {
        throw new Error('Customer account not found.')
      }

      const targetGroupId = code_group_id !== undefined ? code_group_id : currentCfUser.code_group_id
      if (!targetGroupId) {
        throw new Error('An alternative-code group is required.')
      }

      if (code_group_id !== undefined && code_group_id !== currentCfUser.code_group_id) {
        const { data: groupRow, error: groupErr } = await supabaseAdmin
          .from('laminea_code_groups')
          .select('id, is_active')
          .eq('id', code_group_id)
          .single()

        if (groupErr || !groupRow) {
          throw new Error('Selected alternative-code group does not exist.')
        }
        if (!groupRow.is_active) {
          throw new Error('Cannot assign an inactive alternative-code group.')
        }
      }

      const normPrefix = customer_prefix !== undefined
        ? normalizePrefix(customer_prefix)
        : normalizePrefix(currentCfUser.customer_prefix)

      if (!normPrefix || !/^[A-Z0-9]{1,10}$/.test(normPrefix)) {
        throw new Error('Customer prefix/initials is required (1–10 letters or numbers, e.g., NJ).')
      }

      const { data: conflictingPrefix } = await supabaseAdmin
        .from('code_finder_users')
        .select('id, client_name')
        .eq('normalized_prefix', normPrefix)
        .neq('id', user_id)
        .maybeSingle()

      if (conflictingPrefix) {
        throw new Error(`Customer prefix "${normPrefix}" is already assigned to ${conflictingPrefix.client_name}.`)
      }

      const updates: any = {
        code_group_id: targetGroupId,
        customer_prefix: normPrefix,
        updated_at: new Date().toISOString()
      }
      if (client_name !== undefined) updates.client_name = client_name.trim()
      if (contact_person !== undefined) updates.contact_person = contact_person ? contact_person.trim() : null
      if (mobile !== undefined) updates.mobile = mobile ? mobile.trim() : null
      if (is_active !== undefined) updates.is_active = is_active

      const { error: updateErr } = await supabaseAdmin
        .from('code_finder_users')
        .update(updates)
        .eq('id', user_id)
        
      if (updateErr) throw formatDbConstraintError(updateErr, normPrefix)

      return new Response(JSON.stringify({
        success: true,
        code_group_id: targetGroupId,
        customer_prefix: normPrefix
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'DELETE') {
      const { user_id } = payload
      if (!user_id) throw new Error('Missing user_id')

      const { data: cfUser, error: cfErr } = await supabaseAdmin
        .from('code_finder_users')
        .select('auth_user_id')
        .eq('id', user_id)
        .single()
      
      if (cfErr || !cfUser) throw new Error('User not found')

      const { error: delCfErr } = await supabaseAdmin
        .from('code_finder_users')
        .delete()
        .eq('id', user_id)
        
      if (delCfErr) throw delCfErr

      const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(cfUser.auth_user_id)
      
      if (delAuthErr) console.error('Failed to delete auth user:', delAuthErr)

      return new Response(JSON.stringify({ success: true }), {
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
