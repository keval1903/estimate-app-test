import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import { Package, FileText, ClipboardList, MessageCircle, User, LogOut, Bell, BellOff } from 'lucide-react';
import { usePushNotifications } from './hooks/usePushNotifications';

import CheckStock from './pages/CheckStock';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Enquiries from './pages/Enquiries';
import Orders from './pages/Orders';
import Chat from './pages/Chat';
import './App.css';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => {
        if (!res.ok) throw new Error('Not auth');
        return res.json();
      })
      .then(data => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  const login = (userData) => setUser(userData);
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('cf_team_member');
    setUser(null);
  };

  if (loading) return <div className="loading-screen">Loading...</div>;

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return children;
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isSupported, isSubscribed, subscribe, unsubscribe, loading } = usePushNotifications();
  const [teamMember, setTeamMember] = useState(localStorage.getItem('cf_team_member') || '');
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    if (!teamMember) {
      setShowNameModal(true);
    }
  }, [teamMember]);

  const handleSaveName = (e) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    localStorage.setItem('cf_team_member', nameInput.trim());
    setTeamMember(nameInput.trim());
    setShowNameModal(false);
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-top">
          <div className="header-logo">
            <h1>Client Portal</h1>
          </div>
          <div className="header-user">
            {isSupported && (
              <button 
                onClick={isSubscribed ? unsubscribe : subscribe} 
                className="btn-logout" 
                title={isSubscribed ? "Disable Notifications" : "Enable Notifications"}
                disabled={loading}
              >
                {isSubscribed ? <Bell size={18} /> : <BellOff size={18} />}
              </button>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: '10px' }}>
              <span className="client-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><User size={16} /> {user?.client_name}</span>
              {teamMember && (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  By: {teamMember}
                </span>
              )}
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="btn-logout" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <nav className="top-nav">
          <button 
            onClick={() => navigate('/app/check-stock')} 
            className={`nav-btn ${location.pathname.includes('/check-stock') ? 'active' : ''}`}
          >
            <Package size={18} />
            <span>Check Stock</span>
          </button>
          <button 
            onClick={() => navigate('/app/enquiries')} 
            className={`nav-btn ${location.pathname.includes('/enquiries') ? 'active' : ''}`}
          >
            <FileText size={18} />
            <span>Enquiries</span>
          </button>
          <button 
            onClick={() => navigate('/app/orders')} 
            className={`nav-btn ${location.pathname.includes('/orders') ? 'active' : ''}`}
          >
            <ClipboardList size={18} />
            <span>Orders</span>
          </button>
          <button 
            onClick={() => navigate('/app/chat')} 
            className={`nav-btn ${location.pathname.includes('/chat') ? 'active' : ''}`}
          >
            <MessageCircle size={18} />
            <span>Chat</span>
          </button>
        </nav>
      </header>

      <main className="app-content">
        {children}
      </main>

      {showNameModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 16px 0' }}>Who is placing orders?</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: '#64748b' }}>
              Please enter your first name. This helps us know who from your team is placing enquiries or orders.
            </p>
            <form onSubmit={handleSaveName}>
              <input
                type="text"
                autoFocus
                required
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="Enter your name..."
                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', marginBottom: '16px', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {teamMember && (
                  <button type="button" onClick={() => setShowNameModal(false)} style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                )}
                <button type="submit" style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>Save Name</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app/check-stock" replace />} />
          <Route path="/login" element={<Login />} />
          
          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePassword />
            </ProtectedRoute>
          } />
          
          <Route path="/app/*" element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="check-stock" element={<CheckStock />} />
                  <Route path="enquiries" element={<Enquiries />} />
                  <Route path="orders" element={<Orders />} />
                  <Route path="chat" element={<Chat />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
