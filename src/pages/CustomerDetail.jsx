import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';
import { useEnquirySubscription } from '../hooks/useEnquirySubscription';
import { CustomerAccountManager } from '../components/CustomerAccountManager';
import { usePlatform } from '../context/PlatformContext';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isStaff = role === 'STAFF' || role === 'ADMIN';
  const { activePlatform } = usePlatform();
  
  const [customer, setCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState('ENQUIRIES'); // ENQUIRIES, ORDERS, CHAT, ACCOUNT
  const [enquiries, setEnquiries] = useState([]);
  const [orders, setOrders] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [selectedEnquiry, setSelectedEnquiry] = useState(null);
  const [proposalType, setProposalType] = useState('QUANTITY_PROPOSAL');
  const [staffNote, setStaffNote] = useState('');
  const [proposalItems, setProposalItems] = useState([]);
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const { data: userData, error: userErr } = await supabase
        .from('code_finder_users')
        .select('*')
        .eq('id', id)
        .single();
      if (userErr) throw userErr;
      setCustomer(userData);

      const { data: allEnquiries, error: eqErr } = await supabase
        .from('code_finder_enquiries')
        .select(`
          *,
          code_finder_enquiry_items(*),
          code_finder_proposals(
            *,
            code_finder_proposal_items(*)
          )
        `)
        .eq('code_finder_user_id', id)
        .order('created_at', { ascending: false });
      if (eqErr) throw eqErr;

      // Group enquiries
      const activeEnqs = [];
      const confirmedOrds = [];
      
      for (const eq of allEnquiries) {
        if (['NEW', 'UNDER_REVIEW', 'AWAITING_CLIENT', 'REJECTED'].includes(eq.status)) {
          activeEnqs.push(eq);
        } else if (['CONFIRMED', 'CANCELLED'].includes(eq.status)) {
          confirmedOrds.push(eq);
        }
      }
      setEnquiries(activeEnqs);
      setOrders(confirmedOrds);

      const { data: msgs, error: msgErr } = await supabase
        .from('code_finder_messages')
        .select('*')
        .eq('code_finder_user_id', id)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setMessages(msgs);

      // Fetch read cursor
      const { data: authUser } = await supabase.auth.getUser();
      const { data: myRead } = await supabase
        .from('code_finder_message_reads')
        .select('last_read_message_created_at')
        .eq('staff_user_id', authUser.user?.id)
        .eq('code_finder_user_id', id)
        .single();
        
      const lastReadTime = myRead ? new Date(myRead.last_read_message_created_at).getTime() : 0;
      const unreads = msgs.filter(m => m.is_from_client && new Date(m.created_at).getTime() > lastReadTime);
      
      setUnreadChatCount(unreads.length);

      // Enquiries are now marked as read by a separate useEffect when activeTab === 'ENQUIRIES'
      
      // Mark chat as read only if currently on chat tab
      if (activeTab === 'CHAT' && unreads.length > 0) {
        const lastMsg = unreads[unreads.length - 1];
        await supabase.rpc('update_message_read_cursor', { 
          p_cf_user_id: id, 
          p_message_created_at: lastMsg.created_at, 
          p_message_id: lastMsg.id 
        });
        setUnreadChatCount(0);
      }

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  const handleRealtimeUpdate = useCallback((type, payload) => {
    if (payload.new && payload.new.code_finder_user_id === id) {
      fetchData();
    }
  }, [id, activeTab]);

  useEnquirySubscription(handleRealtimeUpdate);

  useEffect(() => {
    if (activeTab === 'CHAT' && unreadChatCount > 0 && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      supabase.rpc('update_message_read_cursor', { 
        p_cf_user_id: id, 
        p_message_created_at: lastMsg.created_at, 
        p_message_id: lastMsg.id 
      }).then(() => {
        setUnreadChatCount(0);
      });
    }
  }, [activeTab, unreadChatCount, messages, id]);

  useEffect(() => {
    if (activeTab === 'ENQUIRIES' && enquiries.length > 0) {
      enquiries.forEach((eq) => {
        supabase.rpc('mark_enquiry_read', { p_enquiry_id: eq.id }).catch(console.error);
      });
    }
  }, [activeTab, enquiries]);

  useEffect(() => {
    if (activeTab === 'CHAT' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.from('code_finder_messages').insert({
        code_finder_user_id: id,
        sender_auth_user_id: session.user.id,
        sender_type: 'STAFF',
        message: chatInput.trim()
      });
      if (error) throw error;
      setChatInput('');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to permanently delete ALL messages in this chat?")) return;
    try {
      const { error } = await supabase.from('code_finder_messages').delete().eq('code_finder_user_id', id);
      if (error) throw error;
      setMessages([]);
    } catch (err) {
      alert("Error clearing chat: " + err.message);
    }
  };

  const handleDeleteMessage = async (msgId) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      const { error } = await supabase.from('code_finder_messages').delete().eq('id', msgId);
      if (error) throw error;
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch (err) {
      alert("Error deleting message: " + err.message);
    }
  };

  const handleUpdateStatus = async (enquiryId, newStatus) => {
    try {
      const { error } = await supabase.rpc('update_enquiry_status', { p_enquiry_id: enquiryId, p_new_status: newStatus });
      if (error) throw error;
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateEstimate = async (enq) => {
    // Navigate to CreateEstimate with prefill
    const enqWithUser = {
      ...enq,
      code_finder_users: {
        client_name: customer?.client_name,
        mobile: customer?.mobile
      }
    };
    navigate(`/${activePlatform}/estimate/new`, { state: { prefillEnquiry: enqWithUser, codeFinderUserId: id } });
  };

  const handleOpenProposalModal = async (enq) => {
    try {
       await supabase.rpc('recheck_enquiry_stock', { p_enquiry_id: enq.id });
       const { data: updatedItems, error } = await supabase.from('code_finder_enquiry_items').select('*').eq('enquiry_id', enq.id);
       if (error) throw error;
       
       setSelectedEnquiry(enq);
       setProposalType('QUANTITY_PROPOSAL');
       setStaffNote('');
       setProposalItems(updatedItems.map(item => ({
          enquiry_item_id: item.id,
          original_code: item.alternative_code_snapshot,
          original_qty: item.requested_quantity,
          proposed_quantity: item.requested_quantity,
          item_note: '',
          availability_status: item.availability_status
       })));
       setProposalModalOpen(true);
    } catch (err) {
       alert("Error checking stock: " + err.message);
    }
  };

  const handleSubmitProposal = async (e) => {
    e.preventDefault();
    setSubmittingProposal(true);
    try {
      const payload = {
        p_enquiry_id: selectedEnquiry.id,
        p_proposal_type: proposalType,
        p_staff_note: staffNote.trim() || null,
        p_items: proposalItems.map(p => ({
           enquiry_item_id: p.enquiry_item_id,
           proposed_quantity: Number(p.proposed_quantity),
           item_note: p.item_note.trim() || null,
           availability_status: p.availability_status
        }))
      };
      
      const { error } = await supabase.rpc('submit_code_finder_proposal', payload);
      if (error) throw error;
      
      setProposalModalOpen(false);
      fetchData();
    } catch (err) {
      alert("Failed to submit proposal: " + err.message);
    } finally {
      setSubmittingProposal(false);
    }
  };

  if (!isStaff) return <div style={{ padding: '2rem', textAlign: 'center', color: 'red' }}>Unauthorized</div>;
  if (loading && !customer) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  if (!customer) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Customer not found</div>;

  return (
    <div className="app-container">
      {proposalModalOpen && selectedEnquiry && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '600px', margin: '20px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>Propose Changes - Enquiry #{selectedEnquiry.enquiry_number}</h3>
            <form onSubmit={handleSubmitProposal}>
              <div className="field">
                <label>Proposal Type</label>
                <select value={proposalType} onChange={e => setProposalType(e.target.value)} className="input">
                  <option value="QUANTITY_PROPOSAL">Quantity Proposal</option>
                  <option value="CLARIFICATION">Clarification (No Quantity Change)</option>
                </select>
              </div>
              
              <div className="field">
                <label>Staff Note to Customer</label>
                <textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} className="input" rows="3" placeholder="Explain the changes or ask for clarification..." />
              </div>

              <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Items</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-light)', textAlign: 'left' }}>
                      <th style={{ padding: '8px' }}>Code</th>
                      <th style={{ padding: '8px' }}>Live Stock</th>
                      <th style={{ padding: '8px', width: '80px' }}>Qty</th>
                      <th style={{ padding: '8px' }}>Item Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposalItems.map((item, idx) => (
                      <tr key={item.enquiry_item_id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace' }}>{item.original_code}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ 
                            padding: '2px 6px', fontSize: '11px', borderRadius: '4px', fontWeight: 'bold',
                            background: item.availability_status === 'AVAILABLE' ? '#dcfce7' : item.availability_status === 'CODE_NOT_FOUND' ? '#fee2e2' : '#fef3c7',
                            color: item.availability_status === 'AVAILABLE' ? '#166534' : item.availability_status === 'CODE_NOT_FOUND' ? '#991b1b' : '#92400e'
                           }}>
                            {item.availability_status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <input 
                            type="number" 
                            min="0" 
                            value={item.proposed_quantity} 
                            onChange={(e) => {
                              const newItems = [...proposalItems];
                              newItems[idx].proposed_quantity = e.target.value;
                              setProposalItems(newItems);
                            }}
                            style={{ width: '100%', padding: '4px' }} 
                            className="input" 
                          />
                        </td>
                        <td style={{ padding: '8px' }}>
                          <input 
                            type="text" 
                            value={item.item_note} 
                            onChange={(e) => {
                              const newItems = [...proposalItems];
                              newItems[idx].item_note = e.target.value;
                              setProposalItems(newItems);
                            }}
                            placeholder="Optional"
                            style={{ width: '100%', padding: '4px' }} 
                            className="input" 
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button type="submit" disabled={submittingProposal} className="btn btn-primary" style={{ flex: 1 }}>{submittingProposal ? 'Submitting...' : 'Submit Proposal'}</button>
                <button type="button" onClick={() => setProposalModalOpen(false)} className="btn btn-secondary" style={{ flex: 1 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="top-nav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="nav-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(`/${activePlatform}/customer-enquiries`)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' }}>←</button>
          {customer.client_name}
        </span>
        <span style={{ fontSize: '14px', opacity: 0.8 }}>@{customer.username}</span>
      </div>

      <div className="page">
        <div style={{ display: 'flex', borderBottom: '2px solid var(--accent)', marginBottom: '16px' }}>
          <button style={{ flex: 1, padding: '12px', border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0', background: activeTab === 'ENQUIRIES' ? 'var(--accent)' : 'transparent', fontWeight: activeTab === 'ENQUIRIES' ? 'bold' : 'normal', color: activeTab === 'ENQUIRIES' ? '#fff' : 'var(--text-muted)' }} onClick={() => setActiveTab('ENQUIRIES')}>
            Enquiries ({enquiries.length})
          </button>
          <button style={{ flex: 1, padding: '12px', border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0', background: activeTab === 'ORDERS' ? 'var(--accent)' : 'transparent', fontWeight: activeTab === 'ORDERS' ? 'bold' : 'normal', color: activeTab === 'ORDERS' ? '#fff' : 'var(--text-muted)' }} onClick={() => setActiveTab('ORDERS')}>
            Orders ({orders.length})
          </button>
          <button style={{ flex: 1, padding: '12px', border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0', background: activeTab === 'CHAT' ? 'var(--accent)' : 'transparent', fontWeight: activeTab === 'CHAT' ? 'bold' : 'normal', color: activeTab === 'CHAT' ? '#fff' : 'var(--text-muted)' }} onClick={() => setActiveTab('CHAT')}>
            Chat {unreadChatCount > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: '12px', padding: '2px 6px', fontSize: '11px', marginLeft: '4px' }}>{unreadChatCount}</span>}
          </button>
          {role === 'ADMIN' && (
            <button style={{ flex: 1, padding: '12px', border: 'none', cursor: 'pointer', borderRadius: '8px 8px 0 0', background: activeTab === 'ACCOUNT' ? 'var(--accent)' : 'transparent', fontWeight: activeTab === 'ACCOUNT' ? 'bold' : 'normal', color: activeTab === 'ACCOUNT' ? '#fff' : 'var(--text-muted)' }} onClick={() => setActiveTab('ACCOUNT')}>
              Account
            </button>
          )}
        </div>

        <div>
          {activeTab === 'ENQUIRIES' && (
            <div>
              {enquiries.map(enq => (
                <div key={enq.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Enquiry #{enq.enquiry_number}</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{format(new Date(enq.created_at), 'MMM d, yyyy h:mm a')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ padding: '2px 8px', fontSize: '12px', fontWeight: 'bold', background: '#fef3c7', color: '#92400e', borderRadius: '12px' }}>
                        {enq.status.replace(/_/g, ' ')}
                      </span>
                      {enq.status === 'UNDER_REVIEW' && (
                         <>
                           <button onClick={() => handleUpdateStatus(enq.id, 'CONFIRMED')} className="btn btn-sm" style={{ background: '#16a34a', color: '#fff' }}>Confirm</button>
                           <button onClick={() => handleOpenProposalModal(enq)} className="btn btn-secondary btn-sm">Propose Changes</button>
                         </>
                      )}
                      {enq.status === 'NEW' && (
                         <>
                           <button onClick={() => handleUpdateStatus(enq.id, 'UNDER_REVIEW')} className="btn btn-primary btn-sm">Start Review</button>
                           <button onClick={() => handleOpenProposalModal(enq)} className="btn btn-secondary btn-sm">Propose Changes</button>
                         </>
                      )}
                      <button onClick={() => handleUpdateStatus(enq.id, 'REJECTED')} className="btn btn-danger btn-sm">Reject</button>
                    </div>
                  </div>
                  
                  {enq.client_note && (
                    <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '4px', borderLeft: '4px solid var(--border-light)', marginBottom: '16px', fontSize: '14px' }}>
                      <strong>Customer Note:</strong><br/>
                      {enq.client_note}
                    </div>
                  )}

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-light)', textAlign: 'left' }}>
                        <th style={{ padding: '8px' }}>Code</th>
                        <th style={{ padding: '8px' }}>Requested</th>
                        <th style={{ padding: '8px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enq.code_finder_enquiry_items?.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px', fontFamily: 'monospace' }}>{item.alternative_code_snapshot}</td>
                          <td style={{ padding: '8px' }}>{item.requested_quantity}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ 
                              padding: '2px 6px', fontSize: '11px', borderRadius: '4px', fontWeight: 'bold',
                              background: item.availability_status === 'AVAILABLE' ? '#dcfce7' : item.availability_status === 'CODE_NOT_FOUND' ? '#fee2e2' : '#fef3c7',
                              color: item.availability_status === 'AVAILABLE' ? '#166534' : item.availability_status === 'CODE_NOT_FOUND' ? '#991b1b' : '#92400e'
                             }}>
                              {item.availability_status.replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {enquiries.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>No pending enquiries.</p>}
            </div>
          )}

          {activeTab === 'ORDERS' && (
            <div>
              {orders.map(ord => (
                <div key={ord.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '18px' }}>Order #{ord.enquiry_number}</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Confirmed on {format(new Date(ord.code_finder_proposals?.find(p => p.response === 'ACCEPTED')?.updated_at || ord.updated_at), 'MMM d, yyyy h:mm a')}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                      <span style={{ padding: '2px 8px', fontSize: '12px', fontWeight: 'bold', background: '#dcfce7', color: '#166534', borderRadius: '12px' }}>
                        {ord.status.replace(/_/g, ' ')}
                      </span>
                      {ord.converted_estimate_id ? (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 'bold' }}>Internal Document Linked</span>
                      ) : (
                        <button onClick={() => handleCreateEstimate(ord)} className="btn btn-primary btn-sm">
                          Create Estimate
                        </button>
                      )}
                      {ord.status === 'CONFIRMED' && (
                         <button onClick={() => handleUpdateStatus(ord.id, 'CANCELLED')} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Cancel Order</button>
                      )}
                    </div>
                  </div>
                  
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-light)', textAlign: 'left' }}>
                        <th style={{ padding: '8px' }}>Code</th>
                        <th style={{ padding: '8px' }}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ord.code_finder_enquiry_items?.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px', fontFamily: 'monospace' }}>{item.alternative_code_snapshot}</td>
                          <td style={{ padding: '8px' }}>{item.requested_quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {orders.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '30px' }}>No confirmed orders.</p>}
            </div>
          )}

          {activeTab === 'CHAT' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '60vh', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end', background: '#f9f9f9' }}>
                <button onClick={handleClearChat} className="btn btn-sm btn-danger" style={{ fontSize: '12px' }}>
                  Clear Chat
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {messages.map((msg, i) => {
                  const isStaffMsg = msg.sender_type === 'STAFF' || msg.sender_type === 'SYSTEM';
                  return (
                    <div key={msg.id || i} style={{ display: 'flex', justifyContent: isStaffMsg ? 'flex-end' : 'flex-start', alignItems: 'center', gap: '8px' }}>
                      {!isStaffMsg && (
                        <button onClick={() => handleDeleteMessage(msg.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', opacity: 0.5, padding: '0 4px' }} title="Delete Message">×</button>
                      )}
                      <div style={{ 
                        maxWidth: '75%', padding: '10px 14px', borderRadius: '8px',
                        background: msg.sender_type === 'SYSTEM' ? '#f0f0f0' : msg.sender_type === 'STAFF' ? 'var(--accent)' : '#e5e5e5',
                        color: msg.sender_type === 'SYSTEM' ? '#555' : msg.sender_type === 'STAFF' ? '#fff' : '#000',
                        fontStyle: msg.sender_type === 'SYSTEM' ? 'italic' : 'normal',
                        fontSize: '14px', whiteSpace: 'pre-wrap'
                      }}>
                        {msg.message}
                        <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.8, textAlign: 'right' }}>
                          {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                        </div>
                      </div>
                      {isStaffMsg && (
                        <button onClick={() => handleDeleteMessage(msg.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', opacity: 0.5, padding: '0 4px' }} title="Delete Message">×</button>
                      )}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <div style={{ padding: '16px', borderTop: '1px solid var(--border-light)', background: '#fff' }}>
                <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="input"
                    style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid var(--border-light)' }}
                  />
                  <button type="submit" disabled={!chatInput.trim()} className="btn btn-primary" style={{ padding: '0 20px' }}>
                    Send
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'ACCOUNT' && role === 'ADMIN' && (
            <div className="card">
              <CustomerAccountManager customer={customer} onUpdate={fetchData} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
