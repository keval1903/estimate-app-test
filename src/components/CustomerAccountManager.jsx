import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function CustomerAccountManager({ customer, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [linkedClientName, setLinkedClientName] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  
  // New client form
  const [newClientName, setNewClientName] = useState('');
  const [newClientMobile, setNewClientMobile] = useState('');
  const [newClientContact, setNewClientContact] = useState('');

  useEffect(() => {
    fetchClients();
    if (customer.laminea_client_id) {
      fetchLinkedClientName();
    }
  }, [customer.laminea_client_id]);

  const fetchClients = async () => {
    try {
      const { data, error: err } = await supabase
        .from('clients')
        .select('id, name, mobile')
        .eq('platform', 'laminea')
        .order('name');
      if (err) throw err;
      setClients(data || []);
    } catch (err) {
      console.error("Error fetching clients:", err);
    }
  };

  const fetchLinkedClientName = async () => {
    try {
      const { data, error: err } = await supabase
        .from('clients')
        .select('name')
        .eq('id', customer.laminea_client_id)
        .single();
      if (err) throw err;
      setLinkedClientName(data.name);
    } catch (err) {
      console.error("Error fetching linked client:", err);
    }
  };

  const handleResetPassword = async () => {
    const newPassword = prompt("Enter new temporary password for this user:");
    if (!newPassword) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/staff-manage-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: 'RESET_PASSWORD',
          user_id: customer.id,
          new_password: newPassword
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reset password');
      }

      setSuccess("Password reset successfully. User will be forced to change it on next login.");
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedClientId) return;
    if (customer.laminea_client_id) {
      if (!window.confirm(`This will unlink the current client (${linkedClientName}) and link a new one. Proceed?`)) {
        return;
      }
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('link_code_finder_client', {
        p_cf_user_id: customer.id,
        p_client_id: selectedClientId
      });
      if (rpcErr) throw rpcErr;
      
      setSuccess("Successfully linked to existing Laminea client.");
      setSelectedClientId('');
      setSearchTerm('');
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndLink = async () => {
    if (!newClientName.trim()) {
      setError("Client name is required.");
      return;
    }
    if (customer.laminea_client_id) {
      if (!window.confirm(`This will unlink the current client (${linkedClientName}) and link the newly created one. Proceed?`)) {
        return;
      }
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: rpcErr } = await supabase.rpc('create_and_link_laminea_client', {
        p_cf_user_id: customer.id,
        p_client_name: newClientName,
        p_mobile: newClientMobile,
        p_contact_person: newClientContact
      });
      if (rpcErr) throw rpcErr;
      
      setSuccess("Successfully created and linked new Laminea client.");
      setNewClientName('');
      setNewClientMobile('');
      setNewClientContact('');
      setIsCreatingNew(false);
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c.mobile && c.mobile.includes(searchTerm))
  ).slice(0, 50);

  return (
    <div style={{ marginTop: '16px' }}>
      <h3 style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '16px' }}>Account Management</h3>
      
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>{error}</div>}
      {success && <div style={{ background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>{success}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Linked Client Section */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
          <h4 style={{ fontWeight: 'bold', marginBottom: '12px' }}>Laminea Client Link</h4>
          
          <div style={{ marginBottom: '16px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Current Status: </span>
            {customer.laminea_client_id ? (
              <span style={{ fontWeight: 'bold', color: '#166534', background: '#dcfce7', padding: '4px 8px', borderRadius: '4px', fontSize: '14px' }}>
                Linked to: {linkedClientName || 'Loading...'}
              </span>
            ) : (
              <span style={{ fontWeight: 'bold', color: '#991b1b', background: '#fee2e2', padding: '4px 8px', borderRadius: '4px', fontSize: '14px' }}>
                Unlinked
              </span>
            )}
          </div>

          {!isCreatingNew ? (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input 
                  type="text" 
                  placeholder="Search existing Laminea clients..."
                  value={searchTerm}
                  onChange={e => {
                    setSearchTerm(e.target.value);
                    if (e.target.value && !selectedClientId) {
                       const found = clients.find(c => c.name.toLowerCase().includes(e.target.value.toLowerCase()));
                       if (found) setSelectedClientId(found.id);
                    }
                  }}
                  className="input"
                  style={{ flex: 1 }}
                />
                <button 
                  onClick={() => setIsCreatingNew(true)} 
                  className="btn btn-secondary"
                  disabled={loading}
                >
                  Create New Instead
                </button>
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <select 
                  value={selectedClientId} 
                  onChange={e => setSelectedClientId(e.target.value)} 
                  className="input" 
                  style={{ flex: 1 }}
                >
                  <option value="">-- Select Client --</option>
                  {filteredClients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} {c.mobile ? `(${c.mobile})` : ''}</option>
                  ))}
                </select>
                <button 
                  onClick={handleLinkExisting} 
                  disabled={!selectedClientId || loading} 
                  className="btn btn-primary"
                >
                  {customer.laminea_client_id ? 'Change Link' : 'Link Client'}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid var(--border-light)', padding: '12px', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h5 style={{ fontWeight: 'bold', margin: 0 }}>Create New Laminea Client</h5>
                <button 
                  onClick={() => setIsCreatingNew(false)} 
                  className="btn btn-sm btn-secondary"
                  style={{ fontSize: '12px', padding: '4px 8px' }}
                >
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                <input type="text" placeholder="Client Name *" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="input" />
                <input type="text" placeholder="Mobile" value={newClientMobile} onChange={e => setNewClientMobile(e.target.value)} className="input" />
                <input type="text" placeholder="Contact Person" value={newClientContact} onChange={e => setNewClientContact(e.target.value)} className="input" />
              </div>
              <button 
                onClick={handleCreateAndLink} 
                disabled={!newClientName.trim() || loading} 
                className="btn btn-primary" 
                style={{ width: '100%' }}
              >
                Create & Link
              </button>
            </div>
          )}
        </div>

        {/* Security Section */}
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '6px' }}>Username / Login ID</label>
          <div style={{ background: '#f9f9f9', padding: '10px', border: '1px solid var(--border-light)', borderRadius: '4px', fontFamily: 'monospace' }}>
            {customer.username}
          </div>
        </div>
        
        <div>
          <button
            onClick={handleResetPassword}
            disabled={loading}
            className="btn btn-danger"
          >
            Reset Password
          </button>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>This will force the user to change their password on next login.</p>
        </div>

      </div>
    </div>
  );
}
