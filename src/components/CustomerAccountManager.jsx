import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function CustomerAccountManager({ customer, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

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

  return (
    <div style={{ marginTop: '16px' }}>
      <h3 style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '16px' }}>Account Management</h3>
      
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>{error}</div>}
      {success && <div style={{ background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>{success}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
