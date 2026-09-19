import { useState, useEffect } from 'react';

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
