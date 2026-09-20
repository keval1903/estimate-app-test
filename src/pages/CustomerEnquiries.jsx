import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { useEnquirySubscription } from '../hooks/useEnquirySubscription';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { usePlatform } from '../context/PlatformContext';

export default function CustomerEnquiries() {
  const [activeTab, setActiveTab] = useState('PENDING'); // PENDING, CUSTOMERS
  const [enquiries, setEnquiries] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;
  
  const navigate = useNavigate();
  const { role } = useAuth();
  const isStaff = role === 'STAFF' || role === 'ADMIN';
  const { activePlatform } = usePlatform();
  const { isSupported, isSubscribed, subscribe, unsubscribe, loading: pushLoading } = usePushNotifications();

  const fetchPending = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('code_finder_enquiries')
        .select(`
          id, enquiry_number, code_finder_user_id, status, created_at,
          code_finder_users ( id, client_name ),
          code_finder_enquiry_items ( id ),
          code_finder_enquiry_reads ( staff_user_id, read_at )
        `)
        .in('status', ['NEW', 'UNDER_REVIEW', 'AWAITING_CLIENT'])
        .order('created_at', { ascending: false });

      if (err) throw err;
      
      const userId = (await supabase.auth.getUser()).data.user?.id;
      
      const formatted = data.map(e => {
        const myRead = e.code_finder_enquiry_reads?.find(r => r.staff_user_id === userId);
        return {
          ...e,
          isUnread: !myRead || new Date(myRead.read_at) < new Date(e.created_at)
        };
      }).sort((a, b) => {
        if (a.isUnread && !b.isUnread) return -1;
        if (!a.isUnread && b.isUnread) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setEnquiries(formatted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('code_finder_users')
        .select(`
          id, client_name, username, mobile, is_active, last_login_at,
          code_finder_enquiries ( id, status, created_at ),
          code_finder_messages ( id, created_at, sender_type ),
          code_finder_message_reads ( staff_user_id, last_read_message_created_at )
        `);

      if (err) throw err;
      
      const userId = (await supabase.auth.getUser()).data.user?.id;

      const formatted = data.map(c => {
        const pendingCount = c.code_finder_enquiries?.filter(e => ['NEW', 'UNDER_REVIEW', 'AWAITING_CLIENT'].includes(e.status)).length || 0;
        const myRead = c.code_finder_message_reads?.find(r => r.staff_user_id === userId);
        
        const latestMsg = c.code_finder_messages?.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
        const latestIncomingMsg = c.code_finder_messages?.filter(m => m.sender_type === 'CLIENT').sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

        const latestMsgDate = latestMsg ? new Date(latestMsg.created_at).getTime() : 0;
        const hasUnreadChat = latestIncomingMsg && (!myRead || new Date(myRead.last_read_message_created_at) < new Date(latestIncomingMsg.created_at));

        const latestEnq = c.code_finder_enquiries?.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
        const latestEnqDate = latestEnq ? new Date(latestEnq.created_at).getTime() : 0;
        const lastInteraction = Math.max(latestMsgDate, latestEnqDate);

        return {
          ...c,
          pendingCount,
          hasUnreadChat,
          lastInteraction
        };
      }).sort((a,b) => {
        if (a.hasUnreadChat && !b.hasUnreadChat) return -1;
        if (!a.hasUnreadChat && b.hasUnreadChat) return 1;
        return b.lastInteraction - a.lastInteraction;
      });
      
      setCustomers(formatted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1); // Reset page on tab change
    if (activeTab === 'PENDING') fetchPending();
    else fetchCustomers();
  }, [activeTab]);

  const handleRealtimeUpdate = useCallback(() => {
    if (activeTab === 'PENDING') fetchPending();
    else fetchCustomers();
  }, [activeTab]);

  useEnquirySubscription(handleRealtimeUpdate);

  const filteredEnquiries = enquiries.filter(e => 
    e.enquiry_number?.toString().includes(searchTerm) ||
    e.code_finder_users?.client_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const paginatedEnquiries = filteredEnquiries.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const filteredCustomers = customers.filter(c => 
    c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.username?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const paginatedCustomers = filteredCustomers.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', client_name: '', contact_person: '', mobile: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState(null);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-manage-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: 'CREATE',
          ...createForm
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create user');
      }
      setShowCreateModal(false);
      setCreateForm({ username: '', password: '', client_name: '', contact_person: '', mobile: '' });
      if (activeTab === 'CUSTOMERS') fetchCustomers();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  if (!isStaff) return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>Unauthorized access.</div>;

  return (
    <div className="app-container">
      {/* Create Modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px', margin: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>Create Code Finder User</h3>
            {createError && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px', borderRadius: '4px', marginBottom: '12px', fontSize: '14px' }}>{createError}</div>}
            <form onSubmit={handleCreateSubmit}>
              <div className="field">
                <label>Company/Client Name *</label>
                <input required type="text" value={createForm.client_name} onChange={e => setCreateForm({...createForm, client_name: e.target.value})} />
              </div>
              <div className="field">
                <label>Username (Login ID) *</label>
                <input required type="text" value={createForm.username} onChange={e => setCreateForm({...createForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '')})} />
              </div>
              <div className="field">
                <label>Temporary Password *</label>
                <input required type="text" value={createForm.password} onChange={e => setCreateForm({...createForm, password: e.target.value})} />
              </div>
              <div className="field">
                <label>Contact Person</label>
                <input type="text" value={createForm.contact_person} onChange={e => setCreateForm({...createForm, contact_person: e.target.value})} />
              </div>
              <div className="field">
                <label>Mobile Number</label>
                <input type="text" value={createForm.mobile} onChange={e => setCreateForm({...createForm, mobile: e.target.value})} />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button type="submit" disabled={createLoading} className="btn btn-primary" style={{ flex: 1 }}>{createLoading ? 'Creating...' : 'Create User'}</button>
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="top-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="nav-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
          Customer Enquiries
        </span>
        
        {isSupported && (
          <button 
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={pushLoading}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid #fff',
              background: isSubscribed ? '#fff' : 'transparent',
              color: isSubscribed ? 'var(--accent)' : '#fff',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold'
            }}
          >
            {pushLoading ? 'Loading...' : isSubscribed ? 'Disable Notifications' : 'Enable Notifications'}
          </button>
        )}
      </div>

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-light)', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flex: 1 }}>
            <button
              style={{
                flex: 1, padding: '12px', background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === 'PENDING' ? '3px solid var(--accent)' : '3px solid transparent',
                fontWeight: activeTab === 'PENDING' ? 'bold' : 'normal',
                color: activeTab === 'PENDING' ? 'var(--accent)' : 'var(--text-muted)'
              }}
              onClick={() => setActiveTab('PENDING')}
            >
              Pending Enquiries
            </button>
            <button
              style={{
                flex: 1, padding: '12px', background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === 'CUSTOMERS' ? '3px solid var(--accent)' : '3px solid transparent',
                fontWeight: activeTab === 'CUSTOMERS' ? 'bold' : 'normal',
                color: activeTab === 'CUSTOMERS' ? 'var(--accent)' : 'var(--text-muted)'
              }}
              onClick={() => setActiveTab('CUSTOMERS')}
            >
              Customers
            </button>
          </div>
          {role === 'ADMIN' && (
            <button 
              onClick={() => setShowCreateModal(true)}
              className="btn btn-sm btn-primary"
              style={{ marginLeft: '12px' }}
            >
              + Create User
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            className="input"
            style={{ flex: 1, padding: '8px' }}
            placeholder="Search..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
          />
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>{error}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>
        ) : activeTab === 'PENDING' ? (
          <div>
            {paginatedEnquiries.map((enquiry) => (
              <div 
                key={enquiry.id}
                className="card"
                onClick={() => {
                  const customerId = enquiry.code_finder_user_id || enquiry.code_finder_users?.id;
                  if (!customerId) {
                    setError('Customer account is not linked to this enquiry.');
                    return;
                  }
                  navigate(`/${activePlatform}/customer-enquiries/${customerId}`);
                }}
                style={{ cursor: 'pointer', borderLeft: enquiry.isUnread ? '4px solid var(--accent)' : '4px solid transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: enquiry.isUnread ? 'var(--accent)' : 'var(--text)' }}>
                    {enquiry.code_finder_users?.client_name || 'Unknown Client'}
                  </div>
                  <div style={{ fontSize: '12px', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: '12px', fontWeight: 'bold' }}>
                    {enquiry.status.replace(/_/g, ' ')}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <div>Enquiry #{enquiry.enquiry_number} • {enquiry.code_finder_enquiry_items?.length} items</div>
                  <div>{format(new Date(enquiry.created_at), 'MMM d, h:mm a')}</div>
                </div>
              </div>
            ))}
            {paginatedEnquiries.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No pending enquiries found.</div>
            )}
            {filteredEnquiries.length > itemsPerPage && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-secondary">Prev</button>
                <span>Page {page} of {Math.ceil(filteredEnquiries.length / itemsPerPage)}</span>
                <button disabled={page >= Math.ceil(filteredEnquiries.length / itemsPerPage)} onClick={() => setPage(p => p + 1)} className="btn btn-secondary">Next</button>
              </div>
            )}
          </div>
        ) : (
          <div>
            {paginatedCustomers.map((customer) => (
              <div 
                key={customer.id} 
                className="card"
                onClick={() => navigate(`/${activePlatform}/customer-enquiries/${customer.id}`)}
                style={{ cursor: 'pointer', border: customer.hasUnreadChat ? '2px solid #ef4444' : '1px solid var(--border-light)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{customer.client_name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {customer.lastInteraction > 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {format(new Date(customer.lastInteraction), 'MMM d, h:mm a')}
                      </span>
                    )}
                    {customer.hasUnreadChat && (
                      <div style={{ width: '10px', height: '10px', background: '#ef4444', borderRadius: '50%' }}></div>
                    )}
                  </div>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '8px' }}>
                  @{customer.username} {customer.mobile && `• ${customer.mobile}`}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {customer.pendingCount > 0 && (
                    <span style={{ fontSize: '12px', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: '4px' }}>
                      {customer.pendingCount} Pending Enquiries
                    </span>
                  )}
                  {!customer.is_active && (
                    <span style={{ fontSize: '12px', padding: '2px 8px', background: '#fee2e2', color: '#b91c1c', borderRadius: '4px' }}>
                      Inactive Account
                    </span>
                  )}
                </div>
              </div>
            ))}
            {paginatedCustomers.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No customers found.</div>
            )}
            {filteredCustomers.length > itemsPerPage && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '16px' }}>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-secondary">Prev</button>
                <span>Page {page} of {Math.ceil(filteredCustomers.length / itemsPerPage)}</span>
                <button disabled={page >= Math.ceil(filteredCustomers.length / itemsPerPage)} onClick={() => setPage(p => p + 1)} className="btn btn-secondary">Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
