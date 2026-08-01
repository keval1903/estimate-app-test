import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

import { checkSessionExpiry } from '../lib/sessionExpiry'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true;

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      // Skip INITIAL_SESSION since getSession below handles it better (including token refresh)
      if (event === 'INITIAL_SESSION') return;
      
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      
      if (session) {
        const isValid = await checkSessionExpiry(supabase);
        if (!isValid) {
          // checkSessionExpiry already called signOut
          setUser(null);
          setLoading(false);
          return;
        }
      }
      
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false;
      subscription.unsubscribe();
    }
  }, [])

  const value = {
    user,
    loading
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
