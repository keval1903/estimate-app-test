import { createClient } from '@supabase/supabase-js'
import { get, set, del } from 'idb-keyval'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const customStorage = {
  getItem: async (key) => {
    const val = await get(key)
    return val ?? null
  },
  setItem: async (key, value) => {
    await set(key, value)
  },
  removeItem: async (key) => {
    await del(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'estimate-app-auth',
    storage: customStorage,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
})
