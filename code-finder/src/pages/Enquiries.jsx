import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchEnquiries();
  }, []);

  const fetchEnquiries = async () => {
    try {
      const res = await fetch('/api/enquiries', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setEnquiries(data.enquiries || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProposalResponse = async (proposalId, response) => {
    try {
      setLoading(true);
      const res = await fetch('/api/proposal-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposalId, response })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit response');
      await fetchEnquiries();
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  };

  const handlePlaceOrder = async (enquiryId) => {
    try {
      setLoading(true);
      const storageKey = `place-order-key:${enquiryId}`;
      let idempotencyKey = sessionStorage.getItem(storageKey);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        sessionStorage.setItem(storageKey, idempotencyKey);
      }

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enquiry_id: enquiryId, idempotency_key: idempotencyKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place order');
      
      sessionStorage.removeItem(storageKey);
      navigate('/app/orders');
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loader">Loading enquiries...</div>;
  if (error) return <div className="error-container">{error}</div>;

  return (
    <div className="page-container">
      <h2>My Enquiries</h2>
      {enquiries.length === 0 ? (
        <div className="empty-state">
          <p>No enquiries submitted yet.</p>
        </div>
      ) : (
        <div className="card-list">
          {enquiries.map(eq => (
            <div key={eq.id} className="item-card">
              <div className="card-header">
                <h3>#{eq.enquiry_number}</h3>
                <span className={`status-badge ${eq.status.toLowerCase()}`}>{eq.status.replace(/_/g, ' ')}</span>
              </div>
              <p className="date-text">Submitted: {new Date(eq.created_at).toLocaleString()}</p>
              
              <div className="items-list">
                {eq.code_finder_enquiry_items?.map(item => (
                  <div key={item.id} className="item-row">
                    <span><strong>{item.alternative_code_snapshot}</strong></span>
                    <span>Qty: {item.requested_quantity}</span>
                    <span className="item-status">{item.availability_status.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
              
              {eq.client_note && (
                <div className="note-box">
                  <strong>Note:</strong> {eq.client_note}
                </div>
              )}
              
              {eq.code_finder_proposals && eq.code_finder_proposals.length > 0 && (
                <div className="proposals-section" style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0' }}>Proposals & Updates</h4>
                  {eq.code_finder_proposals.map(prop => {
                    const isSuperseded = !!prop.superseded_at;
                    return (
                    <div key={prop.id} className="proposal-card" style={{ background: '#f8fafc', color: '#1e293b', padding: '0.75rem', borderRadius: '4px', marginBottom: '0.5rem', opacity: isSuperseded ? 0.6 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                         <span style={{ fontWeight: '600', fontSize: '0.9rem', textDecoration: isSuperseded ? 'line-through' : 'none' }}>
                           {prop.proposal_type === 'QUANTITY_PROPOSAL' ? 'Quantity Proposal' : 'Clarification'} (Rev {prop.revision})
                         </span>
                         {isSuperseded ? (
                            <span className="status-badge" style={{ fontSize: '0.7rem', background: '#e2e8f0', color: '#475569' }}>SUPERSEDED</span>
                         ) : prop.response ? (
                            <span className="status-badge" style={{ fontSize: '0.7rem' }}>{prop.response}</span>
                         ) : (
                            <span className="status-badge" style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e' }}>AWAITING YOUR RESPONSE</span>
                         )}
                      </div>
                      {prop.staff_note && <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem 0' }}><strong>Staff:</strong> {prop.staff_note}</p>}
                      
                      {prop.code_finder_proposal_items && prop.code_finder_proposal_items.length > 0 && (
                        <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                          <strong>Proposed Items:</strong>
                          <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
                             {prop.code_finder_proposal_items.map(pi => {
                               const originalItem = eq.code_finder_enquiry_items.find(i => i.id === pi.enquiry_item_id);
                               return (
                                 <li key={pi.enquiry_item_id}>
                                   <strong>{originalItem ? originalItem.alternative_code_snapshot : 'Item'}</strong> - Qty: {pi.proposed_quantity} {pi.item_note ? `(${pi.item_note})` : ''}
                                 </li>
                               );
                             })}
                          </ul>
                        </div>
                      )}

                      {!isSuperseded && !prop.response && eq.status === 'AWAITING_CLIENT' && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                           {prop.proposal_type === 'QUANTITY_PROPOSAL' && (
                              <button onClick={() => handleProposalResponse(prop.id, 'ACCEPTED')} style={{ padding: '4px 8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Accept Proposal</button>
                           )}
                           <button onClick={() => handleProposalResponse(prop.id, 'CANCELLED')} style={{ padding: '4px 8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel Order</button>
                        </div>
                      )}
                    </div>
                  )})}
                  
                  <div style={{ marginTop: '0.5rem', textAlign: 'right' }}>
                    <button onClick={() => navigate(`/app/chat?enquiry=${eq.id}`)} style={{ padding: '4px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      Reply in Chat
                    </button>
                  </div>
                </div>
              )}
              
              {eq.status === 'READY_TO_ORDER' && (
                <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem', textAlign: 'right' }}>
                  <button onClick={() => handlePlaceOrder(eq.id)} style={{ padding: '8px 16px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                    Place Order
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
