import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

import { checkSessionExpiry } from '../lib/sessionExpiry'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)
  const [onlineUsers, setOnlineUsers] = useState(new Set())

  async function fetchRole(userId) {
    if (!userId) {
      setRole(null)
      return true
    }
    const { data, error } = await supabase
      .from('user_roles')
      .select('role, is_active, current_session_token')
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
      return false
    }

    // Verify session token for single active session
    const localToken = localStorage.getItem('active_session_token')
    if (data.current_session_token) {
      if (localToken !== data.current_session_token) {
        await supabase.auth.signOut()
        localStorage.removeItem('active_session_token')
        alert('You have been logged out because your account was accessed from another device.')
        setRole(null)
        return false
      }
    } else {
      // Legacy session without a token, generate one to prevent getting immediately kicked out by future logins
      const newToken = Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('active_session_token', newToken)
      await supabase.from('user_roles').update({ current_session_token: newToken }).eq('id', userId)
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
        const [isValid, allowed] = await Promise.all([
          checkSessionExpiry(supabase),
          fetchRole(session.user.id)
        ]);
        if (!isValid || !allowed) {
          setUser(null);
          setRole(null);
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

  // Broadcast presence when user is logged in
  useEffect(() => {
    if (!user) {
      setOnlineUsers(new Set())
      return
    }
    
    const channel = supabase.channel('online-users', {
      config: {
        presence: { key: user.id }
      }
    })
    
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      setOnlineUsers(new Set(Object.keys(state)))
    })
    
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() })
      }
    })
    
    return () => {
      channel.unsubscribe()
    }
  }, [user])

  const value = {
    user,
    role,
    loading,
    onlineUsers
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
