import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useEnquirySubscription(onUpdate) {
  useEffect(() => {
    const channel = supabase.channel('enquiries_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'code_finder_enquiries' },
        (payload) => {
          onUpdate('ENQUIRY', payload)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'code_finder_messages' },
        (payload) => {
          onUpdate('MESSAGE', payload)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'code_finder_proposals' },
        (payload) => {
          onUpdate('PROPOSAL', payload)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [onUpdate])
}
