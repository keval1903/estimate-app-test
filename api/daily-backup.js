import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import * as XLSX from 'xlsx';
import { generateExcelWorkbook } from '../src/lib/excelBackup.js';

export default async function handler(req, res) {
  try {
    // Basic security check to ensure this is called by Vercel Cron
    if (
      process.env.VERCEL_CRON_SECRET &&
      req.headers.authorization !== `Bearer ${process.env.VERCEL_CRON_SECRET}`
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Backup Engine] Generating Excel Workbook...');
    const wb = await generateExcelWorkbook(supabase);
    
    console.log('[Backup Engine] Writing to buffer...');
    const dateStr = new Date().toISOString().split('T')[0];
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    console.log(`[Backup Engine] Sending email for ${dateStr}...`);
    const { data, error } = await resend.emails.send({
      from: 'CCAI Backup <onboarding@resend.dev>', // Free tier domain
      to: ['darshanloyapune@gmail.com', 'kevaltaank53@gmail.com'],
      subject: `CCAI Daily Ledger Backup - ${dateStr}`,
      text: 'Please find the daily ledger and estimate backup attached.',
      attachments: [
        {
          filename: `CCAI_Ledger_Backup_${dateStr}.xlsx`,
          content: buffer,
        },
      ],
    });

    if (error) {
      console.error('[Backup Engine] Email send failed:', error);
      return res.status(500).json({ error });
    }

    console.log('[Backup Engine] Email sent successfully:', data);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[Backup Engine] Backup endpoint error:', err);
    return res.status(500).json({ error: err.message });
  }
}
