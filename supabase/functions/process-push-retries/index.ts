import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET')

serve(async (req: Request) => {
  try {
    if (!PUSH_WEBHOOK_SECRET) {
      console.error('PUSH_WEBHOOK_SECRET is not configured')
      return new Response('Server configuration error', { status: 500 })
    }

    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${PUSH_WEBHOOK_SECRET}`) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Find all outbox records that are pending and ready for retry
    const { data: pending, error } = await supabase
      .from('notification_outbox')
      .select('id')
      .is('processed_at', null)
      .lte('next_retry_at', new Date().toISOString())
      .or(`processing_lease_until.is.null,processing_lease_until.lt.${new Date().toISOString()}`)
      .limit(50)

    if (error) throw error

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending pushes' }), {
         headers: { 'Content-Type': 'application/json' }
      })
    }

    // Trigger send-push for each pending message
    // Note: We don't wait for them to finish, just fire off the webhook POSTs
    const responses = await Promise.all(
      pending.map(async outboxRow => {
        const response = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PUSH_WEBHOOK_SECRET}`
          },
          body: JSON.stringify({ id: outboxRow.id })
        })

        if (!response.ok) {
          const body = await response.text()
          throw new Error(`send-push failed for ${outboxRow.id}: ${response.status} ${body}`)
        }

        return response
      })
    )

    return new Response(JSON.stringify({ success: true, processed: pending.length }), { 
      headers: { 'Content-Type': 'application/json' } 
    })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
