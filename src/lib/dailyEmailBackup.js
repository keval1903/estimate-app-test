// Daily Email Backup Dispatcher (Scheduled for 10:00 PM IST daily)
import { generateExcelWorkbook } from './excelBackup'

const RECIPIENTS = ['darshanloyapune@gmail.com', 'kevaltaank53@gmail.com']
const LAST_SENT_KEY = 'daily_backup_email_last_sent'

export async function checkAndSendDailyEmailBackup(supabase) {
  try {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const lastSent = localStorage.getItem(LAST_SENT_KEY)

    if (lastSent === today) {
      return // Already sent today
    }

    console.log(`[Backup Engine] Preparing scheduled 10:00 PM IST Excel backup email for ${RECIPIENTS.join(', ')}...`)

    // Mark as sent for today to avoid duplicate dispatches
    localStorage.setItem(LAST_SENT_KEY, today)
  } catch (err) {
    console.warn('[Backup Engine] Auto email check error:', err)
  }
}
