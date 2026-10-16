import { useCallback, useRef, useState, useEffect } from 'react';
import {
  CalendarCheck,
  LayoutDashboard,
  MessageSquare,
  Moon,
  PhoneCall,
  Plus,
  Settings as SettingsIcon,
  Sun,
  TableProperties,
  Users,
  UsersRound,
  Wrench,
  Briefcase,
  Menu,
  X,
  ArrowLeft,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { io } from 'socket.io-client';
import Dialer from './components/Dialer.jsx';
import CallHistory from './components/CallHistory.jsx';
import Contacts from './components/Contacts.jsx';
import ConversationDetails from './components/ConversationDetails.jsx';
import Messages from './components/Messages.jsx';
import InternalMessages, { InternalMessageDetails } from './components/InternalMessages.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import FollowUps from './components/FollowUps.jsx';
import CRM from './components/CRM.jsx';
import Services from './components/Services.jsx';
import AppToaster from './components/ui/AppToaster.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { confirmAction } from './utils/confirmDialog.js';
import {
  dismissFollowUpReminderToast,
  showFollowUpReminderToast,
  showIncomingSmsToast,
  showSuccessToast,
  showTeamMessageToast
} from './utils/toast.js';
import { normalizePhone, formatPhoneNumber } from './utils/phone.js';
import './App.css';
import { BACKEND_URL } from './config/api.js';

const getUserId = (user) => String(user?.id || user?._id || '');
const getUnreadMessagesKey = (userId) => `unreadMessages:${userId}`;
const getUnreadSmsThreadsKey = (userId) => `unreadSmsThreads:${userId}`;

const readJsonResponse = async (res) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
};

const followUpAlarm = {
  audioContext: null,
  intervalId: null
};

/** Repeating soft two-tone beep generated in the browser (no audio file). */
const playFollowUpBeep = () => {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    if (!followUpAlarm.audioContext || followUpAlarm.audioContext.state === 'closed') {
      followUpAlarm.audioContext = new AudioContextCtor();
    }

    const ctx = followUpAlarm.audioContext;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(1174.66, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.36);
  } catch (err) {
    console.info('Follow-up reminder sound failed:', err);
  }
};

const startFollowUpReminderAlarm = () => {
  if (followUpAlarm.intervalId) return;

  playFollowUpBeep();
  followUpAlarm.intervalId = window.setInterval(playFollowUpBeep, 1200);
};

const stopFollowUpReminderAlarm = () => {
  if (followUpAlarm.intervalId) {
    window.clearInterval(followUpAlarm.intervalId);
    followUpAlarm.intervalId = null;
  }

  if (followUpAlarm.audioContext && followUpAlarm.audioContext.state !== 'closed') {
    void followUpAlarm.audioContext.close();
  }
  followUpAlarm.audioContext = null;
};
const TAB_LABELS = {
  admin: 'Admin',
  history: 'Calls',
  contacts: 'Contacts',
  messages: 'Messages',
  team: 'Team Chat',
  followups: 'Follow Ups',
  services: 'Services',
  crm: 'CRM',
  settings: 'Settings'
};

function NavIcon({ type }) {
  const icons = {
    history: PhoneCall,
    contacts: Users,
    messages: MessageSquare,
    crm: TableProperties,
    team: UsersRound,
    followups: CalendarCheck,
    services: Briefcase,
    parts: Briefcase,
    admin: LayoutDashboard,
    settings: SettingsIcon,
    plus: Plus,
    sun: Sun,
    moon: Moon,
    menu: Menu,
    close: X,
    logout: LogOut
  };

  const Icon = icons[type] || PhoneCall;
  return <Icon className="h-5 w-5" aria-hidden="true" />;
}
function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [activeTab, setActiveTab] = useState('history');
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState('');
  const [selectedMessageNumber, setSelectedMessageNumber] = useState('');
  const [selectedMessageLeadId, setSelectedMessageLeadId] = useState('');
  const [selectedTeamUser, setSelectedTeamUser] = useState(null);
  const [conversationNumber, setConversationNumber] = useState('');
  const [conversationLeadId, setConversationLeadId] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'night');
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadTeamMessages, setUnreadTeamMessages] = useState(0);
  const [dueFollowUps, setDueFollowUps] = useState(0);
  const [showDialerModal, setShowDialerModal] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const activeTabRef = useRef(activeTab);
  const currentUserRef = useRef(currentUser);
  const selectedTeamUserRef = useRef(selectedTeamUser);
  const isAdmin = currentUser?.role === 'admin';

  const openTab = useCallback((tabId) => {
    setActiveTab(tabId);
    setMobileDrawerOpen(false);
    if (tabId !== 'team') {
      setSelectedTeamUser(null);
    }
    if (tabId === 'messages') {
      setUnreadMessages(0);
    }
    if (tabId === 'team') {
      setUnreadTeamMessages(0);
      window.dispatchEvent(new Event('refreshInternalMessages'));
    }
    if (tabId === 'followups') {
      dismissFollowUpReminderToast();
    }
  }, []);

  // Click-to-Call from Contacts
  useEffect(() => {
    const handleCallContact = (event) => {
      const { phoneNumber } = event.detail;
      setSelectedPhoneNumber(phoneNumber);
      setShowDialerModal(true);        // Open Dialer as popup
    };
    window.addEventListener('callContact', handleCallContact);
    return () => window.removeEventListener('callContact', handleCallContact);
  }, []);

  useEffect(() => {
    const handlePasteNumberOnDialer = (event) => {
      const { phoneNumber } = event.detail || {};
      if (!phoneNumber) return;

      setSelectedPhoneNumber(phoneNumber);
      setShowDialerModal(true);
    };

    window.addEventListener('pasteNumberOnDialer', handlePasteNumberOnDialer);
    return () => window.removeEventListener('pasteNumberOnDialer', handlePasteNumberOnDialer);
  }, []);

  useEffect(() => {
    const handleMessageContact = (event) => {
      const { phoneNumber, leadId } = event.detail;
      setSelectedMessageNumber(phoneNumber);
      setSelectedMessageLeadId(leadId || '');
      openTab('messages');
    };

    window.addEventListener('messageContact', handleMessageContact);
    return () => window.removeEventListener('messageContact', handleMessageContact);
  }, [openTab]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    selectedTeamUserRef.current = selectedTeamUser;
  }, [selectedTeamUser]);

  useEffect(() => {
    const userId = getUserId(currentUser);
    if (!userId) {
      setUnreadMessages(0);
      return;
    }

    setUnreadMessages(Number(localStorage.getItem(getUnreadMessagesKey(userId))) || 0);
  }, [currentUser]);

  useEffect(() => {
    const userId = getUserId(currentUser);
    if (!userId) return;

    localStorage.setItem(getUnreadMessagesKey(userId), String(unreadMessages));
  }, [currentUser, unreadMessages]);

  const refreshUnreadTeamMessages = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/internal-messages/unread-count`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await readJsonResponse(res);

      if (res.ok) {
        setUnreadTeamMessages(Number(data.count) || 0);
      }
    } catch (error) {
      console.error('Failed to refresh team message count:', error);
    }
  }, [token]);

  const refreshDueFollowUps = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/followups?mineOnly=true`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await readJsonResponse(res);

      if (!res.ok || !Array.isArray(data)) return;

      const dueItems = data.filter((item) => (
        !item.completed && new Date(item.followUpDate) <= new Date()
      ));

      setDueFollowUps(dueItems.length);

      if (dueItems.length > 0) {
        startFollowUpReminderAlarm();

        if (activeTabRef.current !== 'followups') {
          const firstDue = dueItems[0];
          showFollowUpReminderToast({
            name: firstDue.name,
            note: firstDue.note,
            dueCount: dueItems.length,
            onClick: () => openTab('followups')
          });
        } else {
          dismissFollowUpReminderToast();
        }
      } else {
        stopFollowUpReminderAlarm();
        dismissFollowUpReminderToast();
      }
    } catch (error) {
      console.error('Failed to refresh follow-up reminders:', error);
    }
  }, [openTab, token]);

  useEffect(() => {
    if (!token) return undefined;

    const initialRefresh = window.setTimeout(refreshDueFollowUps, 0);
    const interval = window.setInterval(refreshDueFollowUps, 5000);
    window.addEventListener('refreshFollowUps', refreshDueFollowUps);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener('refreshFollowUps', refreshDueFollowUps);
      stopFollowUpReminderAlarm();
      dismissFollowUpReminderToast();
    };
  }, [refreshDueFollowUps, token]);

  useEffect(() => {
    if (!token) return undefined;

    const fetchCurrentUser = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json();

        if (res.ok) {
          setCurrentUser(data);
        }
      } catch (error) {
        console.error('Failed to load current user:', error);
      }
    };

    fetchCurrentUser();
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;

    const unreadRefreshTimer = window.setTimeout(refreshUnreadTeamMessages, 0);

    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      auth: { token }
    });

    const currentUserId = getUserId(currentUserRef.current);
    if (currentUserId) {
      socket.emit('join-user-room', { userId: currentUserId });
    }

    socket.on('incoming-message', (message) => {
      const assignedRecipients = Array.isArray(message.assignedTo)
        ? message.assignedTo.map((value) => String(value))
        : [String(message.assignedTo || '')].filter(Boolean);
      const currentUserId = getUserId(currentUserRef.current);

      if (!assignedRecipients.includes(currentUserId)) return;

      const threadKey = normalizePhone(message.from) || message.from;
      if (threadKey && activeTabRef.current !== 'messages') {
        const unreadKey = getUnreadSmsThreadsKey(currentUserId);
        const unreadThreads = JSON.parse(localStorage.getItem(unreadKey) || '[]');
        localStorage.setItem(unreadKey, JSON.stringify([...new Set([...unreadThreads, threadKey])]));
      }

      window.dispatchEvent(new CustomEvent('refreshMessages', {
        detail: { message }
      }));

      if (activeTabRef.current !== 'messages') {
        setUnreadMessages((count) => count + 1);
      }

      showIncomingSmsToast({
        from: formatPhoneNumber(message.from) || message.from,
        body: message.body,
        onClick: () => {
          setSelectedMessageNumber(message.from);
          setSelectedMessageLeadId(message.lead || '');
          setConversationNumber(message.from);
          setConversationLeadId(message.lead || '');
          openTab('messages');
        }
      });
    });

    socket.on('call-transcription-updated', () => {
      window.dispatchEvent(new Event('refreshCallHistory'));
    });

    socket.on('refresh-call-history', () => {
      window.dispatchEvent(new Event('refreshCallHistory'));
    });

    socket.on('call-answered-by-teammate', (payload) => {
      window.dispatchEvent(new CustomEvent('callAnsweredByTeammate', {
        detail: payload
      }));
      window.dispatchEvent(new Event('refreshCallHistory'));
    });

    socket.on('message-status-updated', () => {
      window.dispatchEvent(new Event('refreshMessages'));
    });

    socket.on('ai-message-sent', () => {
      window.dispatchEvent(new Event('refreshMessages'));
    });

    socket.on('lead-assigned', (payload) => {
      const assignedUserId = getUserId(currentUserRef.current);
      const leadAssignedToUser = payload?.lead?.assignedTo && getUserId(payload.lead.assignedTo) === assignedUserId;

      if (!leadAssignedToUser) return;

      window.dispatchEvent(new Event('refreshLeads'));
      showSuccessToast(payload.message || 'You were assigned a new lead');
    });

    socket.on('internal-message-created', (message) => {
      window.dispatchEvent(new CustomEvent('refreshInternalMessages', {
        detail: message
      }));
      const user = currentUserRef.current;
      const currentUserId = getUserId(user);
      const senderId = getUserId(message.sender);
      const recipientId = getUserId(message.recipient);

      if (recipientId === currentUserId) {
        refreshUnreadTeamMessages();

        const selectedTeamUserId = getUserId(selectedTeamUserRef.current);
        const isOpenConversation = activeTabRef.current === 'team' && selectedTeamUserId === senderId;

        if (!isOpenConversation) {
          showTeamMessageToast({
            senderName: message.sender?.name,
            onClick: () => {
              setSelectedTeamUser(message.sender);
              openTab('team');
            }
          });
        }
      }
    });

    return () => {
      window.clearTimeout(unreadRefreshTimer);
      socket.disconnect();
    };
  }, [openTab, refreshUnreadTeamMessages, token]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleOpenConversation = (event) => {
      const { phoneNumber, leadId } = event.detail;
      setConversationNumber(phoneNumber);
      setConversationLeadId(leadId || '');
    };

    window.addEventListener('openConversation', handleOpenConversation);
    return () => window.removeEventListener('openConversation', handleOpenConversation);
  }, []);

  const clearSelectedMessageNumber = useCallback(() => {
    setSelectedMessageNumber('');
    setSelectedMessageLeadId('');
  }, []);

  const openNewCall = () => {
    setSelectedPhoneNumber('');
    setShowDialerModal(true);
    window.dispatchEvent(new CustomEvent('openDialer', { detail: { phoneNumber: '' } }));
  };

  const handleLogout = async () => {
    const currentToken = localStorage.getItem('token');

    if (currentToken) {
      try {
        await fetch(`${BACKEND_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${currentToken}`
          }
        });
      } catch (error) {
        console.error('Failed to record logout:', error);
      }
    }

    localStorage.removeItem('token');
    setToken(null);
    setSelectedPhoneNumber('');
    setSelectedMessageNumber('');
    setSelectedMessageLeadId('');
    setSelectedTeamUser(null);
    setConversationNumber('');
    setConversationLeadId('');
    setUnreadMessages(0);
    setUnreadTeamMessages(0);
    setDueFollowUps(0);
    stopFollowUpReminderAlarm();
    dismissFollowUpReminderToast();
    setCurrentUser(null);
  };

  const confirmLogout = () => {
    confirmAction({
      title: 'Logout?',
      text: 'Are you sure you want to logout?',
      confirmButtonText: 'Logout',
      icon: 'warning',
      confirmButtonColor: '#DC2626',
      onConfirm: handleLogout
    });
  };

  const toggleTheme = () => {
    setTheme((current) => current === 'night' ? 'day' : 'night');
  };

  if (!token) {
    return (
      <>
        <Login />
        <AppToaster />
      </>
    );
  }

  const navItems = [
    ...(isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
    { id: 'history', label: 'Calls' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'messages', label: 'Messages', badge: unreadMessages },
    { id: 'team', label: 'Team Chat', badge: unreadTeamMessages },
    { id: 'followups', label: 'Follow Ups', badge: dueFollowUps, badgeColor: 'bg-amber-500' },
    { id: 'services', label: 'Services' },
    { id: 'settings', label: 'Settings' },
  ];

  const isMobileConversationOpen = Boolean(conversationNumber);
  const isMobileTeamChatOpen = activeTab === 'team' && Boolean(selectedTeamUser);
  const isMobileDetailOpen = isMobileConversationOpen || isMobileTeamChatOpen;

  return (
    <div className="app-shell flex h-screen flex-col bg-[#0A0C14] text-white overflow-hidden md:flex-row">
      {/* Mobile Top App Bar */}
      <header className="shrink-0 bg-[#11151F] border-b border-gray-800 flex items-center justify-between px-3.5 py-2.5 pt-safe md:hidden z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 bg-gradient-to-br from-[#059669] via-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-white shadow-md shrink-0">
            <NavIcon type={activeTab} />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-base font-bold tracking-tight text-white truncate">Ultimate</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20 uppercase tracking-wider shrink-0">
                {TAB_LABELS[activeTab] || 'App'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Call Button */}
          <button
            type="button"
            onClick={openNewCall}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white px-2.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition active:scale-95"
            title="New Call"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Call</span>
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-xl text-gray-300 hover:text-white hover:bg-gray-800 transition active:scale-95"
            title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
          >
            <NavIcon type={theme === 'night' ? 'sun' : 'moon'} />
          </button>

          {/* Drawer Menu Button */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="relative p-2 rounded-xl text-gray-300 hover:text-white hover:bg-gray-800 transition active:scale-95"
            title="Open navigation menu"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
            {(unreadMessages > 0 || unreadTeamMessages > 0 || dueFollowUps > 0) && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#11151F]" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Slide-Over Drawer Navigation */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer content */}
          <div className="relative w-[300px] max-w-[85vw] bg-[#11151F] border-r border-gray-800 h-full flex flex-col p-4 shadow-2xl z-10 pt-safe pb-safe overflow-y-auto thin-scrollbar">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-gradient-to-br from-[#059669] via-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
                  <NavIcon type="history" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white truncate">Ultimate</h2>
                  <p className="text-xs text-gray-400 truncate">{currentUser?.name || currentUser?.email || 'User'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-gray-800 transition"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Nav Items */}
            <nav className="flex-1 py-3 space-y-1 overflow-y-auto thin-scrollbar">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition text-left ${
                    activeTab === item.id
                      ? 'bg-gray-800 text-white font-semibold'
                      : 'hover:bg-gray-800/60 text-gray-300'
                  }`}
                >
                  <span className="w-5 text-current shrink-0"><NavIcon type={item.id} /></span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge > 0 && (
                    <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${item.badgeColor || 'bg-red-500'}`}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              ))}

              {/* CRM button in drawer */}
              <button
                type="button"
                onClick={() => openTab('crm')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition text-left ${
                  activeTab === 'crm'
                    ? 'bg-cyan-500 ring-2 ring-cyan-200/50'
                    : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                <span className="w-5 shrink-0"><NavIcon type="crm" /></span>
                <span>CRM Leads</span>
              </button>

              {/* New Call button in drawer */}
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  openNewCall();
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition text-left mt-2"
              >
                <span className="w-5 shrink-0"><NavIcon type="plus" /></span>
                <span>+ New Call</span>
              </button>
            </nav>

            {/* Drawer Footer */}
            <div className="pt-3 border-t border-gray-800 space-y-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-gray-300 hover:bg-gray-800 transition"
              >
                <span className="w-5 shrink-0"><NavIcon type={theme === 'night' ? 'sun' : 'moon'} /></span>
                <span>{theme === 'night' ? 'Day Mode' : 'Night Mode'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  confirmLogout();
                }}
                className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-400 hover:bg-red-950/30 transition"
              >
                <span className="w-5 shrink-0"><LogOut className="h-5 w-5" /></span>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar (hidden on mobile, visible on md+) */}
      <div className="hidden md:flex md:w-60 shrink-0 bg-[#11151F] border-r border-gray-800 flex-col">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-800">
          <div className="w-9 h-9 bg-gradient-to-br from-[#059669] via-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0">
            <NavIcon type="history" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Ultimate</h1>
        </div>

        <nav className="flex-1 flex flex-col gap-1 p-3 overflow-y-auto thin-scrollbar">
          {navItems.map((item) => (
            <div
              key={item.id}
              onClick={() => openTab(item.id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl cursor-pointer text-sm font-medium transition-all ${
                activeTab === item.id ? 'bg-gray-800 text-white font-semibold' : 'hover:bg-gray-800 text-gray-300'
              }`}
            >
              <span className="w-5 text-current shrink-0"><NavIcon type={item.id} /></span>
              <span>{item.label}</span>
              {item.badge > 0 && (
                <span className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${item.badgeColor || 'bg-red-500'}`}>
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>
          ))}

          <div
            onClick={() => openTab('crm')}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all mt-auto ${
              activeTab === 'crm'
                ? 'cursor-default bg-cyan-500 ring-2 ring-cyan-200/50'
                : 'cursor-pointer bg-cyan-600 hover:bg-cyan-500'
            }`}
          >
            <span className="w-5 shrink-0"><NavIcon type="crm" /></span>
            CRM
          </div>

          {/* + New Call Button */}
          <div
            onClick={openNewCall}
            className="flex items-center gap-2 px-4 py-3 rounded-xl cursor-pointer text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-lg mt-3"
          >
            <span className="w-5 shrink-0"><NavIcon type="plus" /></span>
            New Call
          </div>

          {/* Slot for connection status below New Call button */}
          <div id="dialer-status-sidebar-slot" className="empty:hidden w-full mt-2.5" />
        </nav>

        <div className="p-3 border-t border-gray-800">
          <button
            type="button"
            onClick={toggleTheme}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-gray-300 transition hover:bg-gray-800"
            title={theme === 'night' ? 'Switch to day mode' : 'Switch to night mode'}
          >
            <span className="w-5"><NavIcon type={theme === 'night' ? 'sun' : 'moon'} /></span>
            {theme === 'night' ? 'Day' : 'Night'}
          </button>
          <button
            onClick={confirmLogout}
            className="w-full py-2.5 text-sm text-red-400 hover:bg-red-950/30 rounded-xl transition font-medium"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {/* Mobile Master-Detail Condition: If detail view is open on mobile (< lg), render detail view */}
      {isMobileConversationOpen ? (
        <div className="flex-1 min-h-0 flex flex-col bg-[#0F1322] lg:hidden">
          <ConversationDetails
            phoneNumber={conversationNumber}
            leadId={conversationLeadId}
            onClose={() => {
              setConversationNumber('');
              setConversationLeadId('');
            }}
          />
        </div>
      ) : isMobileTeamChatOpen ? (
        <div className="flex-1 min-h-0 flex flex-col bg-[#0F1322] lg:hidden">
          <InternalMessageDetails
            currentUser={currentUser}
            selectedUser={selectedTeamUser}
            onReadMessages={refreshUnreadTeamMessages}
            onBack={() => setSelectedTeamUser(null)}
          />
        </div>
      ) : (
        /* Normal Middle Panel (or Full-screen on mobile) */
        <div className={`min-h-0 flex-1 border-r border-gray-800 bg-[#161B28] flex flex-col md:w-[390px] md:flex-none xl:w-[410px] pb-16 md:pb-0 ${
          activeTab === 'crm' || activeTab === 'services' ? 'lg:hidden' : ''
        }`}>
          <div className="hidden md:flex h-12 md:h-14 border-b border-gray-800 items-center justify-between px-4 md:px-5 bg-[#1C2333]">
            <h2 className="text-base font-semibold md:text-lg">
              {TAB_LABELS[activeTab] || 'Dashboard'}
            </h2>
          </div>

          <div className="flex-1 overflow-auto thin-scrollbar p-2.5 sm:p-3 md:p-3">
            {activeTab === 'admin' && isAdmin && (
              <>
                {/* On mobile (< lg), render all sections of AdminDashboard */}
                <div className="lg:hidden">
                  <AdminDashboard showStats showCreateUser showUsers />
                </div>
                {/* On desktop (lg+), render users only in middle panel */}
                <div className="hidden lg:block">
                  <AdminDashboard showStats={false} showCreateUser={false} showUsers />
                </div>
              </>
            )}
            {activeTab === 'history' && <CallHistory />}
            {activeTab === 'contacts' && <Contacts />}
            {activeTab === 'crm' && <CRM />}
            {activeTab === 'messages' && (
              <Messages
                selectedPhoneNumber={selectedMessageNumber}
                selectedLeadId={selectedMessageLeadId}
                onRecipientUsed={clearSelectedMessageNumber}
                currentUser={currentUser}
              />
            )}
            {activeTab === 'team' && (
              <InternalMessages
                currentUser={currentUser}
                selectedUserId={getUserId(selectedTeamUser)}
                onSelectUser={setSelectedTeamUser}
                onReadMessages={refreshUnreadTeamMessages}
              />
            )}
            {activeTab === 'followups' && (
              <FollowUps onDueCountChange={setDueFollowUps} currentUser={currentUser} />
            )}
            {activeTab === 'services' && <Services currentUser={currentUser} />}
            {activeTab === 'settings' && <Settings />}
          </div>
        </div>
      )}

      {/* Right Persistent Area (Desktop lg+) */}
      <div className="hidden min-w-0 flex-1 flex-col border-l border-gray-800 bg-[#0F1322] lg:flex">
        {activeTab === 'admin' && isAdmin ? (
          <div className="h-full overflow-auto p-4 thin-scrollbar">
            <AdminDashboard showUsers={false} />
          </div>
        ) : activeTab === 'crm' ? (
          <div className="h-full overflow-auto p-4 thin-scrollbar">
            <CRM />
          </div>
        ) : activeTab === 'services' ? (
          <div className="h-full overflow-auto p-4 thin-scrollbar">
            <Services currentUser={currentUser} />
          </div>
        ) : activeTab === 'team' ? (
          <InternalMessageDetails
            currentUser={currentUser}
            selectedUser={selectedTeamUser}
            onReadMessages={refreshUnreadTeamMessages}
          />
        ) : (
          <ConversationDetails
            phoneNumber={conversationNumber}
            leadId={conversationLeadId}
            onClose={() => {
              setConversationNumber('');
              setConversationLeadId('');
            }}
          />
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden when conversation or team chat detail is open) */}
      {!isMobileDetailOpen && (
        <nav
          className="fixed bottom-0 inset-x-0 z-30 h-16 bg-[#11151F]/95 backdrop-blur-xl border-t border-gray-800 flex items-center justify-around px-1 pb-safe md:hidden select-none"
          aria-label="Mobile navigation"
        >
          <button
            type="button"
            onClick={() => openTab('history')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs transition active:scale-95 ${
              activeTab === 'history' ? 'text-emerald-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <PhoneCall className="h-5 w-5 mb-0.5" />
            <span>Calls</span>
          </button>

          <button
            type="button"
            onClick={() => openTab('messages')}
            className={`relative flex flex-col items-center justify-center flex-1 h-full py-1 text-xs transition active:scale-95 ${
              activeTab === 'messages' ? 'text-emerald-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="relative">
              <MessageSquare className="h-5 w-5 mb-0.5" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              )}
            </div>
            <span>Messages</span>
          </button>

          {/* CRM Highlighted Bottom Tab */}
          <button
            type="button"
            onClick={() => openTab('crm')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs transition active:scale-95 ${
              activeTab === 'crm' ? 'text-cyan-400 font-semibold' : 'text-cyan-500/80 hover:text-cyan-300'
            }`}
          >
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-0.5 shadow-sm">
              <TableProperties className="h-4 w-4" />
            </div>
            <span>CRM</span>
          </button>

          <button
            type="button"
            onClick={() => openTab('team')}
            className={`relative flex flex-col items-center justify-center flex-1 h-full py-1 text-xs transition active:scale-95 ${
              activeTab === 'team' ? 'text-emerald-400 font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="relative">
              <UsersRound className="h-5 w-5 mb-0.5" />
              {unreadTeamMessages > 0 && (
                <span className="absolute -top-1 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {unreadTeamMessages > 99 ? '99+' : unreadTeamMessages}
                </span>
              )}
            </div>
            <span>Team</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="relative flex flex-col items-center justify-center flex-1 h-full py-1 text-xs text-gray-400 hover:text-gray-200 transition active:scale-95"
          >
            <div className="relative">
              <Menu className="h-5 w-5 mb-0.5" />
              {dueFollowUps > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </div>
            <span>More</span>
          </button>
        </nav>
      )}

      <Dialer
        selectedPhoneNumber={selectedPhoneNumber}
        isOpen={showDialerModal}
        onClose={() => setShowDialerModal(false)}
        currentUser={currentUser}
      />

      <AppToaster />
    </div>
  );
}

export default App;
