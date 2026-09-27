import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env', 'utf-8')
let url = '', key = ''
for (const line of env.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) url = line.split('=')[1].trim()
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) key = line.split('=')[1].trim()
}

const supabase = createClient(url, key)

async function check() {
  const { data: outbox } = await supabase
    .from('notification_outbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2)
  console.log("Latest Outbox:", outbox)
  
  const { data: msgs } = await supabase
    .from('code_finder_messages')
    .select('id, sender_type, message, created_at, code_finder_user_id')
    .order('created_at', { ascending: false })
    .limit(2)
  console.log("Latest Messages:", msgs)

  if (msgs && msgs.length > 0) {
    const { data: user } = await supabase
      .from('code_finder_users')
      .select('id, auth_user_id, is_active')
      .eq('id', msgs[0].code_finder_user_id)
      .single()
    console.log("User for latest message:", user)
    
    if (user && user.auth_user_id) {
       const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, user_id, endpoint')
        .eq('user_id', user.auth_user_id)
       console.log("Subscriptions for user:", subs)
    }
  }
}
check()
