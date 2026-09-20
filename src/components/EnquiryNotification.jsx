import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

export function EnquiryNotification() {
  const [notifications, setNotifications] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Only subscribe to notifications if the user is STAFF/ADMIN
    const checkStaff = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: role } = await supabase.from('user_roles').select('role').eq('id', user.id).eq('is_active', true).single();
      if (role && ['ADMIN', 'STAFF'].includes(role.role)) {
        subscribeToOutbox();
      }
    };
    checkStaff();

    const subscribeToOutbox = () => {
      const channel = supabase.channel('notification_toast')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_outbox' }, (payload) => {
           const record = payload.new;
           const newNotif = {
             id: record.id,
             tag: record.notification_tag,
             type: record.event_type,
             payload: record.event_payload
           };

           setNotifications(prev => {
             // Deduplicate by tag
             const filtered = prev.filter(n => n.tag !== newNotif.tag);
             return [...filtered, newNotif];
           });

           // Auto dismiss after 5 seconds
           setTimeout(() => {
             setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
           }, 5000);
        })
        .subscribe();
      
      return () => { supabase.removeChannel(channel) };
    };
  }, []);

  const handleClick = (notif) => {
    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    if (notif.payload.user_id) {
      const pathParts = window.location.pathname.split('/');
      const platform = pathParts.length > 1 && ['ccai', 'dc', 'laminea', 'phs'].includes(pathParts[1]) ? pathParts[1] : 'laminea';
      navigate(`/${platform}/customer-enquiries/${notif.payload.user_id}`);
    }
  };

  if (notifications.length === 0) return null;

  return (
    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {notifications.map(notif => (
        <div 
          key={notif.id}
          onClick={() => handleClick(notif)}
          style={{ 
            background: 'var(--accent)', color: '#fff', padding: '12px 16px', borderRadius: 'var(--radius)', 
            boxShadow: 'var(--shadow)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
            minWidth: '250px'
          }}
        >
          <div style={{ background: '#fff', color: 'var(--accent)', borderRadius: '50%', padding: '4px', display: 'flex' }}>
            <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
          </div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
              {notif.type === 'NEW_ENQUIRY' ? 'New Customer Enquiry' : 
               notif.type === 'NEW_MESSAGE' ? 'New Customer Message' : 
               notif.type === 'PROPOSAL_RESPONSE' ? `Proposal ${notif.payload.response}` : 'New Notification'}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>Click to view details</div>
          </div>
        </div>
      ))}
    </div>
  );
}
