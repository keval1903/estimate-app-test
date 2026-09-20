import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"
import webpush from "npm:web-push@3.6.7"

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET')

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@ccai.in', VAPID_PUBLIC, VAPID_PRIVATE)
}

serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${PUSH_WEBHOOK_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response('VAPID keys not configured', { status: 500 })
    }

    const payload = await req.json()
    // Database webhook payload sends the new record in `record`
    const outboxId = payload.record?.id || payload.id
    if (!outboxId) return new Response('Missing outbox ID', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Atomically claim the outbox row
    const { data: claim, error: claimErr } = await supabase
      .from('notification_outbox')
      .update({ processing_lease_until: new Date(Date.now() + 60000).toISOString() })
      .eq('id', outboxId)
      .is('processed_at', null)
      .or(`processing_lease_until.is.null,processing_lease_until.lt.${new Date().toISOString()}`)
      .select('*')
      .single()

    if (claimErr || !claim) {
      return new Response('Already processing or processed', { status: 200 })
    }

    // Get all active push subscriptions for staff
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('id, user_id, endpoint, keys_p256dh, keys_auth')

    if (subsErr || !subs || subs.length === 0) {
      await supabase.from('notification_outbox').update({ processed_at: new Date().toISOString() }).eq('id', outboxId)
      return new Response('No subscriptions', { status: 200 })
    }

    // Determine notification content based on event_type
    let title = 'Laminea Code Finder'
    let body = 'New activity in Customer Enquiries'
    const url = '/customer-enquiries'

    if (claim.event_type === 'NEW_ENQUIRY') {
      body = 'A customer submitted a new enquiry'
    } else if (claim.event_type === 'NEW_MESSAGE') {
      body = 'A customer sent a new message'
    } else if (claim.event_type === 'PROPOSAL_RESPONSE') {
      body = `Customer responded to a proposal: ${claim.event_payload.response}`
    }

    const pushPayload = JSON.stringify({
      title,
      body,
      url,
      tag: claim.notification_tag
    })

    // Fetch existing delivery logs to deduplicate per device
    const { data: logs } = await supabase
      .from('push_delivery_log')
      .select('subscription_id')
      .eq('outbox_id', outboxId)
      .eq('status', 'SUCCESS')
    
    const successfulSubs = new Set((logs || []).map(l => l.subscription_id))
    let hasFailures = false

    for (const sub of subs) {
      if (successfulSubs.has(sub.id)) continue; // Already succeeded

      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys_p256dh,
          auth: sub.keys_auth
        }
      }

      try {
        await webpush.sendNotification(pushSub, pushPayload)
        
        await supabase.from('push_delivery_log').upsert({
          outbox_id: outboxId,
          subscription_id: sub.id,
          status: 'SUCCESS',
          attempted_at: new Date().toISOString()
        }, { onConflict: 'outbox_id,subscription_id' })
        
        await supabase.from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', sub.id)

      } catch (err: any) {
        console.error(`Push failed for sub ${sub.id}:`, err)
        
        const isExpired = err.statusCode === 404 || err.statusCode === 410
        await supabase.from('push_delivery_log').upsert({
          outbox_id: outboxId,
          subscription_id: sub.id,
          status: isExpired ? 'EXPIRED' : 'FAILED',
          attempted_at: new Date().toISOString()
        }, { onConflict: 'outbox_id,subscription_id' })

        if (isExpired) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          hasFailures = true
          // Increment failure count, could delete if > 3
          const { data: currentSub } = await supabase.from('push_subscriptions').select('failure_count').eq('id', sub.id).single()
          if (currentSub && currentSub.failure_count >= 3) {
             await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          } else {
             await supabase.from('push_subscriptions').update({ failure_count: (currentSub?.failure_count || 0) + 1 }).eq('id', sub.id)
          }
        }
      }
    }

    if (hasFailures && claim.retry_count < claim.max_retries) {
      const backoff = Math.pow(2, claim.retry_count) * 60000 // 1m, 2m, 4m
      await supabase.from('notification_outbox')
        .update({
          retry_count: claim.retry_count + 1,
          next_retry_at: new Date(Date.now() + backoff).toISOString(),
          processing_lease_until: null
        })
        .eq('id', outboxId)
    } else {
      await supabase.from('notification_outbox')
        .update({ processed_at: new Date().toISOString(), processing_lease_until: null })
        .eq('id', outboxId)
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
