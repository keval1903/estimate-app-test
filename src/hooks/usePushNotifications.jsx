import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { user, isStaff } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true)
      if (user?.id) {
        checkSubscription()
      } else {
        setLoading(false)
        setIsSubscribed(false)
      }
    } else {
      setLoading(false)
    }
  }, [user?.id])

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      const subscription = await registration.pushManager.getSubscription()
      
      if (subscription && user) {
        // Verify it exists in DB for this user
        const { data } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('endpoint', subscription.endpoint)
          .eq('user_id', user.id)
          .single()

        setIsSubscribed(!!data)
      } else {
        setIsSubscribed(false)
      }
    } catch (err) {
      console.error('Error checking push subscription:', err)
      setIsSubscribed(false)
    } finally {
      setLoading(false)
    }
  }

  const subscribe = async () => {
    if (!user || !isStaff) return false;
    setLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
      
      if (!vapidPublicKey) {
        throw new Error('VAPID public key not found in env')
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapidPublicKey)
      })

      const subData = JSON.parse(JSON.stringify(subscription))

      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: subData.endpoint,
        keys_p256dh: subData.keys.p256dh,
        keys_auth: subData.keys.auth
      }, { onConflict: 'user_id,endpoint' })

      if (error) throw error

      setIsSubscribed(true)
      return true
    } catch (err) {
      console.error('Failed to subscribe to push:', err)
      return false
    } finally {
      setLoading(false)
    }
  }

  const unsubscribe = async () => {
    if (!user) return false;
    setLoading(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      
      if (subscription) {
        await subscription.unsubscribe()
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      }
      setIsSubscribed(false)
      return true
    } catch (err) {
      console.error('Failed to unsubscribe:', err)
      return false
    } finally {
      setLoading(false)
    }
  }

  return { isSupported, isSubscribed, subscribe, unsubscribe, loading }
}
