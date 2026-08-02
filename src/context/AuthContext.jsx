import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

import { checkSessionExpiry } from '../lib/sessionExpiry'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchRole(userId) {
    if (!userId) {
      setRole(null)
      return true
    }
    const { data, error } = await supabase
      .from('user_roles')
      .select('role, is_active')
      .eq('id', userId)
      .single()
      
    if (error || !data) {
      console.error('Error fetching role:', error)
      // Fallback to ADMIN if the table doesn't exist yet (e.g. migration hasn't been run)
      if (error && error.code === '42P01') {
        setRole('ADMIN')
        return true
      }
      return false
    }

    if (!data.is_active) {
      await supabase.auth.signOut()
      alert('Your account has been disabled. Please contact the administrator.')
      setRole(null)
      return false
    }

    setRole(data.role)
    return true
  }

  useEffect(() => {
    let mounted = true;

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      // Skip INITIAL_SESSION since getSession below handles it better (including token refresh)
      if (event === 'INITIAL_SESSION') return;
      
      if (session?.user) {
        const allowed = await fetchRole(session.user.id)
        if (allowed) {
          setUser(session.user)
        } else {
          setUser(null)
        }
      } else {
        setUser(null)
        setRole(null)
      }
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
          setRole(null);
          setLoading(false);
          return;
        }

        const allowed = await fetchRole(session.user.id)
        if (!allowed) {
          setUser(null)
          setLoading(false)
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
    role,
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
