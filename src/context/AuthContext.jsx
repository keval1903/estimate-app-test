import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

import { checkSessionExpiry, getNext5AM } from '../lib/sessionExpiry'

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
        // Wait 3 seconds to see if a delayed login script is about to update the token
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        // Check database one more time
        const retry = await supabase.from('user_roles').select('current_session_token').eq('id', userId).single()
        
        // Re-read localToken in case Login.jsx was delayed by IndexedDB or network operations
        const freshLocalToken = localStorage.getItem('active_session_token')
        
        if (retry.data?.current_session_token && freshLocalToken !== retry.data.current_session_token) {
          await supabase.auth.signOut()
          localStorage.removeItem('active_session_token')
          alert(`You have been logged out because your account was accessed from another device.\n\nDebug Info: Local(${freshLocalToken}) !== DB(${retry.data.current_session_token})`)
          setRole(null)
          return false
        }
      }
    } else {
      // Legacy session without a token, generate one to prevent getting immediately kicked out by future logins
      const newToken = Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('active_session_token', newToken)
      const expiresAt = new Date(getNext5AM()).toISOString();
      await supabase.rpc('update_my_session_token', { 
        new_token: newToken,
        expires_at: expiresAt
      })
    }

    setRole(data.role)
    return true
  }

  useEffect(() => {
    let mounted = true;

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      // Skip INITIAL_SESSION since getSession below handles it better (including token refresh)
      if (event === 'INITIAL_SESSION') return;
      
      const processAuthChange = async () => {
        // Prevent race condition: Wait for Login.jsx to finish its DB updates
        if (event === 'SIGNED_IN') {
          while (localStorage.getItem('login_in_progress') === 'true') {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        if (session?.user) {
          const allowed = await fetchRole(session.user.id)
          if (mounted) {
            if (allowed) {
              setUser(session.user)
            } else {
              setUser(null)
            }
          }
        } else {
          if (mounted) {
            setUser(null)
            setRole(null)
          }
        }
        if (mounted) setLoading(false)
      };

      // Run asynchronously to prevent deadlocking signInWithPassword
      processAuthChange();
    })

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      try {
        if (session) {
          const isValid = await checkSessionExpiry(supabase);
          if (!isValid) {
            setUser(null);
            setRole(null);
            return;
          }

          const allowed = await fetchRole(session.user.id)
          if (!allowed) {
            setUser(null);
            return;
          }
        }
        setUser(session?.user ?? null)
      } catch (err) {
        console.error('Session initialization error:', err);
      } finally {
        if (mounted) setLoading(false)
      }
    }).catch((err) => {
      console.error('supabase getSession failed:', err);
      if (mounted) setLoading(false);
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
