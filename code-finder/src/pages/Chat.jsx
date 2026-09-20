import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../App';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  
  const { user } = useAuth();
  const messagesEndRef = useRef(null);
  const isPollingRef = useRef(true);
  const lastTimestampRef = useRef(null); // Track latest message timestamp for incremental polling

  // Initial full load (no ?after= param)
  const fetchAllMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/messages', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        const msgs = data.messages || [];
        setMessages(msgs);
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          lastTimestampRef.current = `${lastMsg.created_at},${lastMsg.id}`;
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Incremental poll (only new messages since last timestamp)
  const pollNewMessages = useCallback(async () => {
    if (!lastTimestampRef.current) {
      // No messages yet — do a full fetch instead
      await fetchAllMessages();
      return;
    }
    try {
      const res = await fetch(`/api/messages?after=${encodeURIComponent(lastTimestampRef.current)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        const newMsgs = data.messages || [];
        if (newMsgs.length > 0) {
          setMessages(prev => {
            // Ensure no duplicates by ID
            const existingIds = new Set(prev.map(m => m.id));
            const uniqueNew = newMsgs.filter(m => !existingIds.has(m.id));
            return [...prev, ...uniqueNew];
          });
          const lastMsg = newMsgs[newMsgs.length - 1];
          lastTimestampRef.current = `${lastMsg.created_at},${lastMsg.id}`;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [fetchAllMessages]);

  useEffect(() => {
    fetchAllMessages();
    
    // Incremental polling every 5 seconds
    const interval = setInterval(() => {
      if (isPollingRef.current && document.visibilityState === 'visible') {
        pollNewMessages();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchAllMessages, pollNewMessages]);

  useEffect(() => {
    const handleVisibility = () => {
      isPollingRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [searchParams] = useSearchParams();
  const enquiryId = searchParams.get('enquiry');

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: newMessage.trim(),
          enquiry_id: enquiryId || null 
        })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to send message');
      
      const sentMsg = data.message;
      setMessages(prev => [...prev, sentMsg]);
      lastTimestampRef.current = `${sentMsg.created_at},${sentMsg.id}`;
      setNewMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="page-loader">Loading chat...</div>;

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Support Chat</h2>
      </div>
      
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>Send a message to start chatting with our support team.</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message-bubble ${msg.sender_type === 'CLIENT' ? 'sent' : 'received'}`}>
              <div className="message-content">{msg.message}</div>
              <div className="message-time">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {error && <div className="error-text small">{error}</div>}
        <form onSubmit={handleSend} className="chat-form">
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            maxLength={2000}
            disabled={sending}
          />
          <button type="submit" disabled={!newMessage.trim() || sending} className="btn-primary">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
