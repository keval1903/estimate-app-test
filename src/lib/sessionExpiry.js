import { get, set, del } from 'idb-keyval';

const EXPIRY_KEY = 'daily_session_expiry';

export function getNext5AM() {
  const now = new Date();
  const next5AM = new Date(now);
  
  if (now.getHours() >= 5) {
    // If it's already 5 AM or later, the next 5 AM is tomorrow
    next5AM.setDate(next5AM.getDate() + 1);
  }
  // Set time exactly to 5:00:00.000 AM
  next5AM.setHours(5, 0, 0, 0);
  return next5AM.getTime();
}

export async function setSessionExpiry() {
  try {
    const expiryTime = getNext5AM();
    await set(EXPIRY_KEY, expiryTime);
  } catch (e) {
    console.error('Failed to set session expiry:', e);
  }
}

export async function checkSessionExpiry(supabase) {
  try {
    const expiryTime = await get(EXPIRY_KEY);
    
    // If there's no expiry set, we'll allow the session to remain (fail-safe)
    if (!expiryTime) return true; 
    
    const now = Date.now();
    if (now >= expiryTime) {
      // It's past 5 AM of the target day, clear the expiry and sign out
      await del(EXPIRY_KEY).catch(() => {});
      await supabase.auth.signOut().catch(() => {});
      return false; // Session is expired
    }
    
    return true; // Session is valid
  } catch (err) {
    console.error('Session expiry check fail-safe:', err);
    return true; // Fail safe: allow app to load
  }
}
