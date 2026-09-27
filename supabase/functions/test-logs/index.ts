import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: logs } = await supabase.from('push_delivery_log').select('*').order('attempted_at', { ascending: false }).limit(5)

  return new Response(JSON.stringify({ logs }, null, 2), { headers: { 'Content-Type': 'application/json' } })
})
