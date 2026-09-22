import { useState, useEffect } from 'react';

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loader">Loading orders...</div>;
  if (error) return <div className="error-container">{error}</div>;

  return (
    <div className="page-container">
      <h2>Placed Orders</h2>
      {orders.length === 0 ? (
        <div className="empty-state">
          <p>No placed orders yet.</p>
        </div>
      ) : (
        <div className="card-list">
          {orders.map(order => (
            <div key={order.id} className="item-card order-card">
              <div className="card-header">
                <h3>Enquiry #{order.enquiry_number}</h3>
                <span className="status-badge confirmed">ORDER PLACED</span>
              </div>
              <p className="date-text">
                {order.order_placed_at
                  ? `Order Date: ${new Date(order.order_placed_at).toLocaleString()}`
                  : `Enquiry Date: ${new Date(order.checked_at || order.created_at).toLocaleString()}`}
              </p>
              
              <div className="items-list">
                {order.code_finder_enquiry_items?.map(item => (
                  <div key={item.id} className="item-row">
                    <span><strong>{item.alternative_code_snapshot}</strong></span>
                    <span>Qty: {item.requested_quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
