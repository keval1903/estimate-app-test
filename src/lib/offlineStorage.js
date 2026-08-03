// Automatic Local Cache Fallback Manager

const CACHE_KEY_CLIENTS = 'offline_cache_clients'
const CACHE_KEY_ESTIMATES = 'offline_cache_estimates'
const CACHE_KEY_PAYMENTS = 'offline_cache_payments'
const CACHE_KEY_PRODUCTS = 'offline_cache_products'
const CACHE_TIMESTAMP = 'offline_cache_timestamp'

export async function syncOfflineCache(supabase) {
  try {
    const [clientsRes, estimatesRes, paymentsRes, productsRes] = await Promise.allSettled([
      supabase.from('clients').select('*'),
      supabase.from('estimates').select('*'),
      supabase.from('client_payments').select('*'),
      supabase.from('products').select('*')
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

export function getOfflineData(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function getOfflineCacheStatus() {
  const ts = localStorage.getItem(CACHE_TIMESTAMP)
  return ts ? new Date(ts).toLocaleString('en-IN') : null
}
