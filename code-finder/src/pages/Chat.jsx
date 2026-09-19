import { useState, useEffect, useRef } from 'react';
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

  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/messages', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    
    // Authenticated polling every 5 seconds
    const interval = setInterval(() => {
      if (isPollingRef.current && document.visibilityState === 'visible') {
        fetchMessages();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

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

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;
    
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to send message');
      
      setMessages([...messages, data.message]);
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
