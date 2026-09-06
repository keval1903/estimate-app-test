// Automatic Local Cache Fallback Manager

export async function syncOfflineCache(supabase, activePlatform) {
  if (!activePlatform) return

  const CACHE_KEY_CLIENTS = `offline_cache_clients_${activePlatform}`
  const CACHE_KEY_ESTIMATES = `offline_cache_estimates_${activePlatform}`
  const CACHE_KEY_PAYMENTS = `offline_cache_payments_${activePlatform}`
  const CACHE_KEY_PRODUCTS = `offline_cache_products_${activePlatform}`
  const CACHE_TIMESTAMP = `offline_cache_timestamp_${activePlatform}`

  try {
    const [clientsRes, estimatesRes, paymentsRes, productsRes] = await Promise.allSettled([
      supabase.from('clients').select('*').eq('platform', activePlatform),
      supabase.from('estimates').select('*').eq('platform', activePlatform),
      supabase.from('payments').select('*').eq('platform', activePlatform),
      supabase.from('products').select('*') // Products are shared across platforms, or do they have in_platform flags? Wait, I'll leave products alone since they use in_platform flags inside the app.
    ])

    if (clientsRes.status === 'fulfilled' && clientsRes.value.data) {
      localStorage.setItem(CACHE_KEY_CLIENTS, JSON.stringify(clientsRes.value.data))
    }
    if (estimatesRes.status === 'fulfilled' && estimatesRes.value.data) {
      localStorage.setItem(CACHE_KEY_ESTIMATES, JSON.stringify(estimatesRes.value.data))
    }
    if (paymentsRes.status === 'fulfilled' && paymentsRes.value.data) {
      localStorage.setItem(CACHE_KEY_PAYMENTS, JSON.stringify(paymentsRes.value.data))
    }
    if (productsRes.status === 'fulfilled' && productsRes.value.data) {
      localStorage.setItem(CACHE_KEY_PRODUCTS, JSON.stringify(productsRes.value.data))
    }

    localStorage.setItem(CACHE_TIMESTAMP, new Date().toISOString())
  } catch (e) {
    console.warn('Offline cache sync skipped:', e)
  }
}

export function getOfflineData(key, activePlatform) {
  try {
    const actualKey = activePlatform ? `${key}_${activePlatform}` : key
    const raw = localStorage.getItem(actualKey)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function getOfflineCacheStatus(activePlatform) {
  const actualKey = activePlatform ? `offline_cache_timestamp_${activePlatform}` : 'offline_cache_timestamp'
  const ts = localStorage.getItem(actualKey)
  return ts ? new Date(ts).toLocaleString('en-IN') : null
}
