import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Device } from '@twilio/voice-sdk';
import {
  Minus,
  X,
  Maximize2,
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Volume2,
  Pause,
  Play,
  GripHorizontal,
  RotateCcw,
  Delete,
  Hash
} from 'lucide-react';
import { BACKEND_URL } from '../config/api.js';

const DEVICE_STATES = {
  INITIALIZING: 'initializing',
  REGISTERING: 'registering',
  REFRESHING: 'refreshing',
  READY: 'ready',
  OFFLINE: 'offline',
  ERROR: 'error',
};

const fetchTwilioToken = async () => {
  const authToken = localStorage.getItem('token');
  if (!authToken) {
    throw new Error('Not signed in');
  }

  const res = await fetch(`${BACKEND_URL}/api/twilio/token`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  const data = await res.json();

  if (!res.ok || !data.token) {
    throw new Error(data.message || 'Unable to get Twilio token');
  }

  return data.token;
};

const INCOMING_ALERT_TITLE = 'Incoming call';
const INCOMING_ALERT_BODY = 'Open Dialio to answer or reject.';

const canUseNotifications = () => (
  typeof window !== 'undefined'
  && window.isSecureContext
  && 'Notification' in window
);

const getIncomingCallerNumber = (conn) => {
  const customFrom = conn?.customParameters?.get?.('originalFrom');
  return customFrom || conn?.parameters?.originalFrom || conn?.parameters?.From || 'Unknown Number';
};

const getIncomingAllottedNumber = (conn) => {
  const customTo = conn?.customParameters?.get?.('originalTo');
  return customTo || conn?.parameters?.originalTo || conn?.parameters?.To || '';
};

const getParentCallSid = (conn) => {
  const customSid = conn?.customParameters?.get?.('parentCallSid');
  return customSid || conn?.parameters?.parentCallSid || conn?.parameters?.CallSid || '';
};

const getIncomingCallContext = (conn) => {
  const getParam = (name) => conn?.customParameters?.get?.(name) || conn?.parameters?.[name] || '';

  return {
    lastHandledBy: getParam('lastHandledBy'),
    lastHandledByName: getParam('lastHandledByName'),
    lastHandledAt: getParam('lastHandledAt'),
    lastCallType: getParam('lastCallType'),
    lastCallStatus: getParam('lastCallStatus')
  };
};

const getUserId = (user) => String(user?.id || user?._id || '');

const formatLastHandledAt = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const getDialableClipboardValue = (value) => String(value || '')
  .replace(/[^\d+*#]/g, '')
  .replace(/(?!^)\+/g, '');

const isEditingText = (target) => {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable);
};

const formatCallDuration = (sec = 0) => {
  const safeSec = Math.max(0, Math.floor(sec || 0));
  const mins = Math.floor(safeSec / 60);
  const remainingSecs = safeSec % 60;
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
};

function Dialer({ selectedPhoneNumber = '', isOpen = true, onClose, currentUser = null }) {
  const [phoneNumber, setPhoneNumber] = useState(selectedPhoneNumber);
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [callStatus, setCallStatus] = useState('Ready');
  const [deviceState, setDeviceState] = useState(DEVICE_STATES.INITIALIZING);
  const [deviceError, setDeviceError] = useState('');
  const [isCalling, setIsCalling] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isIncomingMinimized, setIsIncomingMinimized] = useState(false);

  // Drag state for floating dialer
  const [position, setPosition] = useState(null); // null = default corner position
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dialerRef = useRef(null);

  const [statusSlotNode, setStatusSlotNode] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.getElementById('dialer-status-sidebar-slot');
    }
    return null;
  });

  useEffect(() => {
    if (!statusSlotNode && typeof document !== 'undefined') {
      const el = document.getElementById('dialer-status-sidebar-slot');
      if (el) setStatusSlotNode(el);
    }
  }, [statusSlotNode]);

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const activeCallRef = useRef(null);
  const currentUserRef = useRef(currentUser);
  const resolveInboundCallEndRef = useRef(async () => {});
  const incomingNotificationRef = useRef(null);
  const titleAlertRef = useRef(null);
  const originalTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');
  const ringtoneAudioRef = useRef(null);
  const deviceRef = useRef(null);
  const tokenRefreshRef = useRef(null);
  const retryDeviceRegistrationRef = useRef(async () => {});

  const isDeviceReady = deviceState === DEVICE_STATES.READY;
  const shouldShowExpandedDialer = (isOpen || isCalling) && !isMinimized;

  const retryDeviceRegistration = () =>
    retryDeviceRegistrationRef.current();

  const formatIncomingAlertText = (from) => from || 'Unknown Number';

  const stopIncomingAlerts = () => {
    incomingNotificationRef.current?.close?.();
    incomingNotificationRef.current = null;

    if (titleAlertRef.current) {
      window.clearInterval(titleAlertRef.current);
      titleAlertRef.current = null;
      document.title = originalTitleRef.current;
    }

    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      try {
        ringtoneAudioRef.current.currentTime = 0;
      } catch {
        // Some browsers do not allow seeking a MediaStream-backed audio element.
      }
    }
  };

  const createRingtoneAudio = () => {
    if (ringtoneAudioRef.current) return ringtoneAudioRef.current;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;

    const audioContext = new AudioContextCtor();
    const duration = 1.8;
    const sampleRate = audioContext.sampleRate;
    const frameCount = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, frameCount, sampleRate);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i += 1) {
      const time = i / sampleRate;
      const isTone = (time % 0.9) < 0.55;
      const tone = Math.sin(2 * Math.PI * 440 * time) + Math.sin(2 * Math.PI * 554.37 * time);
      channel[i] = isTone ? tone * 0.18 : 0;
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.start();

    const audio = new Audio();
    audio.srcObject = destination.stream;
    audio.loop = true;
    ringtoneAudioRef.current = audio;
    return audio;
  };

  const playIncomingRingtone = async () => {
    try {
      const audio = createRingtoneAudio();
      if (!audio) return;

      await audio.play();
    } catch (err) {
      console.info('Incoming call ringtone was blocked by the browser:', err);
    }
  };

  const requestNotificationPermission = async () => {
    if (!canUseNotifications() || Notification.permission !== 'default') return;

    try {
      await Notification.requestPermission();
    } catch (err) {
      console.info('Notification permission request failed:', err);
    }
  };

  const startTitleAlert = (from) => {
    if (titleAlertRef.current) return;

    let showAlert = true;
    const alertTitle = `${INCOMING_ALERT_TITLE}: ${formatIncomingAlertText(from)}`;
    originalTitleRef.current = document.title;
    document.title = alertTitle;

    titleAlertRef.current = window.setInterval(() => {
      document.title = showAlert ? alertTitle : originalTitleRef.current;
      showAlert = !showAlert;
    }, 1000);
  };

  const showNativeIncomingNotification = async (from) => {
    if (!canUseNotifications()) return;

    if (Notification.permission === 'default') {
      await requestNotificationPermission();
    }

    if (Notification.permission !== 'granted') return;

    incomingNotificationRef.current?.close?.();
    incomingNotificationRef.current = new Notification(INCOMING_ALERT_TITLE, {
      body: `${formatIncomingAlertText(from)}\n${INCOMING_ALERT_BODY}`,
      tag: 'dialio-incoming-call',
      requireInteraction: true
    });

    incomingNotificationRef.current.onclick = () => {
      window.focus();
      setIsIncomingMinimized(false);
      incomingNotificationRef.current?.close?.();
    };
  };

  const startIncomingAlerts = (from) => {
    startTitleAlert(from);
    playIncomingRingtone();

    if (navigator.vibrate) {
      navigator.vibrate([300, 120, 300, 120, 300]);
    }

    if (document.hidden || !document.hasFocus()) {
      showNativeIncomingNotification(from);
    }
  };

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Handle external open & phone number change
  useEffect(() => {
    if (isOpen) {
      setIsMinimized(false);
      if (selectedPhoneNumber && !isCalling) {
        setPhoneNumber(selectedPhoneNumber);
      }
    }
  }, [isOpen, selectedPhoneNumber, isCalling]);

  // Handle click-to-call or open dialer events
  useEffect(() => {
    const handleOpenFromEvent = (e) => {
      const { phoneNumber: num } = e.detail || {};
      if (num && !isCalling) {
        setPhoneNumber(num);
      }
      setIsMinimized(false);
    };

    window.addEventListener('callContact', handleOpenFromEvent);
    window.addEventListener('pasteNumberOnDialer', handleOpenFromEvent);
    window.addEventListener('openDialer', handleOpenFromEvent);

    return () => {
      window.removeEventListener('callContact', handleOpenFromEvent);
      window.removeEventListener('pasteNumberOnDialer', handleOpenFromEvent);
      window.removeEventListener('openDialer', handleOpenFromEvent);
    };
  }, [isCalling]);

  useEffect(() => {
    const handleTeammateAnswered = (event) => {
      const {
        callSid,
        parentCallSid,
        answeredBy,
        answeredByName,
        assignedUserIds = []
      } = event.detail || {};
      const sessionCallSid = parentCallSid || callSid;
      const currentUserId = getUserId(currentUserRef.current);

      if (!sessionCallSid || !currentUserId) return;
      if (!assignedUserIds.map(String).includes(currentUserId)) return;
      if (String(answeredBy) === currentUserId) return;

      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.parentCallSid !== sessionCallSid || currentCall.accepted) return;

      activeCallRef.current = {
        ...currentCall,
        teammateAnswered: true,
        answeredBy,
        answeredByName,
        logged: true
      };

      stopIncomingAlerts();
      setIncomingCall(null);
      setIsIncomingMinimized(false);
      setConnection(null);
      resetCall();
    };

    window.addEventListener('callAnsweredByTeammate', handleTeammateAnswered);
    return () => window.removeEventListener('callAnsweredByTeammate', handleTeammateAnswered);
  }, []);

  useEffect(() => {
    const unlockAlerts = () => {
      requestNotificationPermission();
      createRingtoneAudio();
    };

    window.addEventListener('pointerdown', unlockAlerts, { once: true });
    window.addEventListener('keydown', unlockAlerts, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlockAlerts);
      window.removeEventListener('keydown', unlockAlerts);
      stopIncomingAlerts();
    };
  }, []);

  // Keyboard paste handling (does not intercept typing in forms or search)
  useEffect(() => {
    const handlePaste = (event) => {
      if (isEditingText(event.target)) return;
      if (!isOpen || isCalling || incomingCall || isMinimized) return;

      const pastedNumber = getDialableClipboardValue(event.clipboardData?.getData('text'));
      if (!pastedNumber) return;

      event.preventDefault();
      setPhoneNumber(pastedNumber);
      setIsMinimized(false);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [incomingCall, isCalling, isOpen, isMinimized]);

  // Keyboard number dialing (does not intercept typing in forms or search)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isEditingText(event.target)) return;
      if (!isOpen || isCalling || incomingCall || isMinimized) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        handleCloseDialer();
        return;
      }

      if (/^\d$/.test(event.key) || event.key === '*' || event.key === '#') {
        event.preventDefault();
        setPhoneNumber((current) => current + event.key);
        setIsMinimized(false);
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        setPhoneNumber((current) => current.slice(0, -1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [incomingCall, isCalling, isOpen, isMinimized]);

  // Duration Timer management
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const startCallTimer = (existingStartTime = null) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const startTime = existingStartTime || startTimeRef.current || Date.now();
    startTimeRef.current = startTime;
    setDuration(Math.floor((Date.now() - startTime) / 1000));

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  };

  const stopCallTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    startTimeRef.current = null;
    setDuration(0);
  };

  // Draggable window handlers
  const handleHeaderMouseDown = (e) => {
    if (e.target.closest('button')) return;
    if (e.button !== 0) return;

    const rect = dialerRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: rect.left,
      posY: rect.top,
    };

    setIsDragging(true);
  };

  const handleHeaderTouchStart = (e) => {
    if (e.target.closest('button')) return;
    const touch = e.touches[0];
    if (!touch) return;

    const rect = dialerRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStartRef.current = {
      mouseX: touch.clientX,
      mouseY: touch.clientY,
      posX: rect.left,
      posY: rect.top,
    };

    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      const dialerWidth = dialerRef.current?.offsetWidth || 350;
      const dialerHeight = dialerRef.current?.offsetHeight || 500;

      const newX = dragStartRef.current.posX + deltaX;
      const newY = dragStartRef.current.posY + deltaY;

      const clampedX = Math.max(8, Math.min(window.innerWidth - dialerWidth - 8, newX));
      const clampedY = Math.max(8, Math.min(window.innerHeight - dialerHeight - 8, newY));

      setPosition({ x: clampedX, y: clampedY });
    };

    const handleTouchMove = (e) => {
      const touch = e.touches[0];
      if (!touch) return;

      const deltaX = touch.clientX - dragStartRef.current.mouseX;
      const deltaY = touch.clientY - dragStartRef.current.mouseY;

      const dialerWidth = dialerRef.current?.offsetWidth || 350;
      const dialerHeight = dialerRef.current?.offsetHeight || 500;

      const newX = dragStartRef.current.posX + deltaX;
      const newY = dragStartRef.current.posY + deltaY;

      const clampedX = Math.max(8, Math.min(window.innerWidth - dialerWidth - 8, newX));
      const clampedY = Math.max(8, Math.min(window.innerHeight - dialerHeight - 8, newY));

      setPosition({ x: clampedX, y: clampedY });
    };

    const handleDragEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  // Keep within bounds on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!position) return;
      const dialerWidth = dialerRef.current?.offsetWidth || 350;
      const dialerHeight = dialerRef.current?.offsetHeight || 500;

      const clampedX = Math.max(8, Math.min(window.innerWidth - dialerWidth - 8, position.x));
      const clampedY = Math.max(8, Math.min(window.innerHeight - dialerHeight - 8, position.y));

      if (clampedX !== position.x || clampedY !== position.y) {
        setPosition({ x: clampedX, y: clampedY });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [position]);

  // Initialize Twilio Device + Incoming Call Listener
  useEffect(() => {
    let twilioDevice;
    let disposed = false;

    const refreshDeviceToken = async (activeDevice, { silent = false } = {}) => {
      if (!activeDevice || tokenRefreshRef.current) return false;

      tokenRefreshRef.current = true;
      if (!silent) {
        setDeviceState(DEVICE_STATES.REFRESHING);
        setDeviceError('');
      }

      try {
        const token = await fetchTwilioToken();
        activeDevice.updateToken(token);
        return true;
      } catch (err) {
        console.error('Twilio token refresh failed:', err);
        setDeviceState(DEVICE_STATES.ERROR);
        setDeviceError(err.message || 'Unable to refresh phone connection');
        return false;
      } finally {
        tokenRefreshRef.current = false;
      }
    };

    const retryDeviceRegistration = async () => {
      const activeDevice = deviceRef.current;
      if (!activeDevice) return;

      setDeviceState(DEVICE_STATES.REGISTERING);
      setDeviceError('');

      try {
        const token = await fetchTwilioToken();
        activeDevice.updateToken(token);
        await activeDevice.register();
      } catch (err) {
        console.error('Twilio device retry failed:', err);
        setDeviceState(DEVICE_STATES.OFFLINE);
        setDeviceError(err.message || 'Unable to connect phone service');
      }
    };

    retryDeviceRegistrationRef.current = retryDeviceRegistration;

    const handleVisibilityChange = () => {
      if (disposed || document.visibilityState !== 'visible' || !twilioDevice) return;
      if (twilioDevice.state === Device.State.Registered) return;

      retryDeviceRegistration();
    };

    const initDevice = async () => {
      setDeviceState(DEVICE_STATES.INITIALIZING);
      setDeviceError('');

      try {
        const token = await fetchTwilioToken();
        if (disposed) return;

        twilioDevice = new Device(token, {
          edge: ['singapore', 'tokyo'],
          logLevel: 'warn',
        });
        deviceRef.current = twilioDevice;

        twilioDevice.on('registering', () => {
          setDeviceState(DEVICE_STATES.REGISTERING);
        });

        twilioDevice.on('registered', () => {
          setDeviceState(DEVICE_STATES.READY);
          setDeviceError('');
          setCallStatus('Ready');
        });

        twilioDevice.on('unregistered', () => {
          setDeviceState(DEVICE_STATES.OFFLINE);
          setDeviceError('Phone service disconnected');
        });

        twilioDevice.on('tokenWillExpire', () => {
          refreshDeviceToken(twilioDevice);
        });

        // Listen for Incoming Calls
        twilioDevice.on('incoming', (conn) => {
          const from = getIncomingCallerNumber(conn);
          const localNumber = getIncomingAllottedNumber(conn);
          const parentCallSid = getParentCallSid(conn);
          const callerContext = getIncomingCallContext(conn);
          console.log("📲 Incoming call from:", from, "| session:", parentCallSid);

          activeCallRef.current = {
            callType: 'inbound',
            phoneNumber: from,
            localNumber,
            callSid: parentCallSid,
            parentCallSid,
            accepted: false,
            logged: false
          };

          setIncomingCall({
            from,
            callSid: parentCallSid,
            ...callerContext
          });
          setIsIncomingMinimized(false);
          setConnection(conn);
          startIncomingAlerts(from);

          conn.on('cancel', () => resolveInboundCallEndRef.current());
          conn.on('disconnect', () => {
            if (activeCallRef.current?.accepted) {
              handleCallEnd(conn, {
                phoneNumber: from,
                localNumber,
                callType: 'inbound',
                status: 'completed'
              });
            } else {
              resolveInboundCallEndRef.current();
            }
          });
          conn.on('reject', () => {
            if (activeCallRef.current) {
              activeCallRef.current = {
                ...activeCallRef.current,
                rejected: true
              };
            }
          });
          conn.on('error', () => resolveInboundCallEndRef.current());
        });

        twilioDevice.on('error', (err) => {
          console.error('Twilio Device Error:', err);
          setDeviceState(DEVICE_STATES.ERROR);
          setDeviceError(err.message || 'Phone service error');
          setCallStatus('Device error');

          if (err.code === 20104 || err.code === 31205 || err.code === 31204) {
            refreshDeviceToken(twilioDevice).then((refreshed) => {
              if (refreshed && !disposed) {
                twilioDevice.register().catch(() => {});
              }
            });
          }
        });

        setDeviceState(DEVICE_STATES.REGISTERING);
        await twilioDevice.register();
        if (disposed) return;

        setDevice(twilioDevice);
        console.log('Twilio Device Registered');
      } catch (err) {
        console.error('Device Initialization Error:', err);
        setDeviceState(DEVICE_STATES.OFFLINE);
        setDeviceError(err.message || 'Unable to connect phone service');
        setCallStatus('Device offline');
      }
    };

    initDevice();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      deviceRef.current = null;
      if (twilioDevice) {
        twilioDevice.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchInboundSession = async ({ callSid, phoneNumber, localNumber }, attempts = 3) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const params = new URLSearchParams();
        if (phoneNumber) params.set('phoneNumber', phoneNumber);
        if (localNumber) params.set('localNumber', localNumber);
        const query = params.toString();
        const res = await fetch(
          `${BACKEND_URL}/api/calls/session/${encodeURIComponent(callSid)}${query ? `?${query}` : ''}`,
          {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          }
        );

        if (res.ok) {
          const session = await res.json();
          if (session.status === 'answered' || attempt === attempts - 1) {
            return session;
          }
        }
      } catch (err) {
        console.error('Failed to fetch inbound session:', err);
      }

      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }

    return null;
  };

  const logCall = async ({ phoneNumber, localNumber, callType, duration, status, callSid, answeredBy }) => {
    const currentCall = activeCallRef.current;
    if (currentCall?.callSid === callSid && currentCall.logged) return;

    if (currentCall?.callSid === callSid) {
      activeCallRef.current = { ...currentCall, logged: true };
    }

    try {
      await fetch(`${BACKEND_URL}/api/calls/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          phoneNumber,
          localNumber,
          callType,
          duration,
          status,
          callSid,
          answeredBy
        })
      });

      window.dispatchEvent(new Event('refreshCallHistory'));
    } catch (err) {
      console.error(err);
    }
  };

  const clearIncomingCallState = () => {
    setIncomingCall(null);
    setIsIncomingMinimized(false);
    setConnection(null);
    stopIncomingAlerts();
    resetCall();
  };

  const resolveInboundCallEnd = async () => {
    const currentCall = activeCallRef.current;
    if (!currentCall || currentCall.callType !== 'inbound') {
      clearIncomingCallState();
      return;
    }

    if (currentCall.accepted) {
      clearIncomingCallState();
      return;
    }

    if (currentCall.logged) {
      clearIncomingCallState();
      return;
    }

    const {
      phoneNumber,
      localNumber,
      callSid,
      rejected,
      teammateAnswered,
      answeredBy: teammateAnsweredBy
    } = currentCall;
    const currentUserId = getUserId(currentUserRef.current);

    if (teammateAnswered && teammateAnsweredBy && String(teammateAnsweredBy) !== currentUserId) {
      await logCall({
        phoneNumber,
        localNumber,
        callType: 'inbound',
        status: 'answered-by-teammate',
        duration: 0,
        callSid,
        answeredBy: teammateAnsweredBy
      });
      clearIncomingCallState();
      return;
    }

    const session = callSid
      ? await fetchInboundSession({ callSid, phoneNumber, localNumber })
      : null;
    if (session?.status === 'answered' && session.answeredBy && String(session.answeredBy) !== currentUserId) {
      await logCall({
        phoneNumber,
        localNumber,
        callType: 'inbound',
        status: 'answered-by-teammate',
        duration: 0,
        callSid,
        answeredBy: session.answeredBy
      });
      clearIncomingCallState();
      return;
    }

    await logCall({
      phoneNumber,
      localNumber,
      callType: 'inbound',
      status: rejected ? 'rejected' : 'missed',
      duration: 0,
      callSid
    });
    clearIncomingCallState();
  };

  resolveInboundCallEndRef.current = resolveInboundCallEnd;

  const makeCall = async () => {
    if (!phoneNumber.trim()) return alert('Please enter a valid number');
    if (!device || !isDeviceReady) {
      return alert('Phone service is not ready yet. Wait for Ready status or tap Retry on the connection banner.');
    }

    setIsMinimized(false);
    setIsCalling(true);
    setCallStatus('Ringing...');
    stopCallTimer();

    try {
      const conn = await device.connect({ params: { To: phoneNumber.trim() } });
      setConnection(conn);
      activeCallRef.current = {
        callType: 'outbound',
        phoneNumber: phoneNumber.trim(),
        callSid: conn?.parameters?.CallSid || '',
        accepted: false,
        logged: false
      };

      const handleConnected = () => {
        setCallStatus('Connected');
        if (!startTimeRef.current) {
          startCallTimer();
        }
        activeCallRef.current = {
          ...activeCallRef.current,
          accepted: true,
          callSid: conn?.parameters?.CallSid || activeCallRef.current?.callSid || ''
        };
      };

      conn.on('accept', handleConnected);

      const connStatus = typeof conn.status === 'function' ? conn.status() : conn.status;
      if (connStatus === 'open') {
        handleConnected();
      }

      conn.on('ringing', () => {
        setCallStatus('Ringing...');
      });

      conn.on('reconnecting', () => {
        setCallStatus('Reconnecting...');
      });

      conn.on('reconnected', () => {
        setCallStatus('Connected');
      });

      conn.on('cancel', () => handleCallEnd(conn, { status: 'canceled' }));
      conn.on('reject', () => handleCallEnd(conn, { status: 'rejected' }));
      conn.on('disconnect', () => handleCallEnd(conn));
      conn.on('error', () => handleCallEnd(conn, { status: 'failed' }));
    } catch (err) {
      console.error(err);
      resetCall();
    }
  };

  const handleCallEnd = async (conn, overrides = {}) => {
    const finalDuration = startTimeRef.current
      ? Math.floor((Date.now() - startTimeRef.current) / 1000)
      : 0;

    await logCall({
      phoneNumber: overrides.phoneNumber || activeCallRef.current?.phoneNumber || phoneNumber.trim(),
      localNumber: overrides.localNumber || activeCallRef.current?.localNumber || '',
      callType: overrides.callType || activeCallRef.current?.callType || 'outbound',
      duration: finalDuration,
      status: overrides.status || 'completed',
      callSid: conn?.parameters?.CallSid || activeCallRef.current?.callSid || ''
    });

    resetCall();
  };

  const resetCall = () => {
    setIsCalling(false);
    setCallStatus(isDeviceReady ? 'Ready' : 'Device offline');
    setConnection(null);
    setIsMuted(false);
    setIsOnHold(false);
    setIsSpeakerOn(false);
    setShowKeypad(false);
    setIsMinimized(false);
    setIsIncomingMinimized(false);
    stopCallTimer();
  };

  const handleMinimizeDialer = () => {
    setIsMinimized(true);
  };

  const handleCloseDialer = () => {
    if (isCalling) {
      // Avoid accidental disconnect - minimize call instead
      setIsMinimized(true);
      return;
    }
    setIsMinimized(false);
    onClose?.();
  };

  const restoreDialer = () => {
    setIsMinimized(false);
  };

  const endCall = () => connection && connection.disconnect();

  const toggleMute = () => {
    if (connection) {
      const newMuted = !isMuted;
      connection.mute(newMuted);
      setIsMuted(newMuted);
    }
  };

  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);

  const toggleHold = () => {
    if (connection) {
      const newHold = !isOnHold;
      connection.mute(newHold);
      setIsOnHold(newHold);
      setCallStatus(newHold ? 'On Hold' : 'Connected');
    }
  };

  const sendDTMF = (digit) => connection && connection.sendDigits(digit);

  const markCallAnswered = async ({ callSid, phoneNumber, localNumber }) => {
    if (!callSid) return;

    try {
      await fetch(`${BACKEND_URL}/api/calls/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ callSid, phoneNumber, localNumber })
      });
    } catch (err) {
      console.error('Failed to mark call answered:', err);
    }
  };

  // Accept Incoming Call
  const acceptIncomingCall = async () => {
    if (connection) {
      const parentCallSid = activeCallRef.current?.parentCallSid
        || getParentCallSid(connection)
        || activeCallRef.current?.callSid
        || '';

      connection.accept();
      activeCallRef.current = {
        ...(activeCallRef.current || {}),
        accepted: true,
        callSid: parentCallSid,
        parentCallSid
      };

      await markCallAnswered({
        callSid: parentCallSid,
        phoneNumber: activeCallRef.current?.phoneNumber,
        localNumber: activeCallRef.current?.localNumber
      });
      stopIncomingAlerts();
      setIncomingCall(null);
      setIsIncomingMinimized(false);
      setIsMinimized(false);
      setPhoneNumber(activeCallRef.current?.phoneNumber || '');
      setIsCalling(true);
      setCallStatus('Connected');
      startCallTimer();
    }
  };

  // Reject Incoming Call
  const rejectIncomingCall = () => {
    if (connection) {
      activeCallRef.current = {
        ...(activeCallRef.current || {}),
        rejected: true
      };
      connection.reject();
    }
    stopIncomingAlerts();
    setIncomingCall(null);
    setIsIncomingMinimized(false);
    setConnection(null);
  };

  return (
    <>
      {/* =========================================================
          Incoming Call Floating Card (Non-blocking & Minimizable)
          ========================================================= */}
      {incomingCall && !isIncomingMinimized && (
        <div className="fixed bottom-5 right-5 z-[60] w-full max-w-sm rounded-2xl border border-emerald-500/50 bg-[#1C2333]/98 backdrop-blur-xl p-5 shadow-2xl text-white dialer-floating-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Incoming Call
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsIncomingMinimized(true)}
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700/60 transition"
              title="Minimize incoming call"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          <div className="text-center py-2">
            <div className="w-14 h-14 mx-auto mb-2 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 animate-pulse">
              <PhoneIncoming className="w-7 h-7" />
            </div>
            <p className="text-lg font-semibold text-white break-all mb-1">
              {incomingCall.from || 'Unknown Number'}
            </p>
          </div>

          {incomingCall.lastHandledByName && (
            <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Recent company history
              </p>
              <p className="mt-0.5 text-xs text-white">
                Last handled by {incomingCall.lastHandledByName}
              </p>
              {incomingCall.lastHandledAt && (
                <p className="text-[11px] text-gray-300">
                  {formatLastHandledAt(incomingCall.lastHandledAt)}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={rejectIncomingCall}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-semibold transition active:scale-95"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={acceptIncomingCall}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Phone className="w-4 h-4" />
              <span>Accept</span>
            </button>
          </div>
        </div>
      )}

      {/* Minimized Incoming Call Pill */}
      {incomingCall && isIncomingMinimized && (
        <div className="dialer-minimized-card fixed bottom-5 right-5 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-emerald-500/40 bg-[#161B28]/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl text-white">
          <button
            type="button"
            onClick={() => setIsIncomingMinimized(false)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span className="flex h-3 w-3 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate max-w-[140px]">
              <span className="block truncate text-xs font-semibold text-white">
                {incomingCall.from || 'Incoming Call'}
              </span>
              <span className="block text-[10px] text-emerald-400 truncate">
                {incomingCall.lastHandledByName ? `Last: ${incomingCall.lastHandledByName}` : 'Incoming call'}
              </span>
            </span>
          </button>
          <div className="flex items-center gap-1.5 pl-2 border-l border-gray-700/80">
            <button
              type="button"
              onClick={rejectIncomingCall}
              className="rounded-lg bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 text-xs font-medium text-white transition"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={acceptIncomingCall}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white shadow transition"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          Sidebar Connection Status Portal
          ========================================================= */}
      {!isCalling && !incomingCall && deviceState !== DEVICE_STATES.READY && (() => {
        const isErrorOrOffline = deviceState === DEVICE_STATES.ERROR || deviceState === DEVICE_STATES.OFFLINE;
        const targetSlot = statusSlotNode || (typeof document !== 'undefined' ? document.getElementById('dialer-status-sidebar-slot') : null);

        const content = (
          <div
            className={`w-full rounded-xl border p-2.5 shadow-lg transition-all ${
              isErrorOrOffline
                ? 'border-amber-500/30 bg-[#1A1410]'
                : 'border-sky-500/25 bg-[#101A28]'
            }`}
          >
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      isErrorOrOffline ? 'bg-amber-400' : 'bg-sky-400 animate-pulse'
                    }`}
                  />
                  <p className="truncate text-xs font-semibold text-white">
                    {isErrorOrOffline ? 'Not receiving calls' : 'Connecting phone service'}
                  </p>
                </div>
                {isErrorOrOffline && (
                  <button
                    type="button"
                    onClick={retryDeviceRegistration}
                    className="shrink-0 rounded-lg bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-[#1A1410] hover:bg-amber-400 transition active:scale-95"
                  >
                    Retry
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-300 leading-snug break-words">
                {deviceError || (
                  deviceState === DEVICE_STATES.REFRESHING
                    ? 'Refreshing connection so shared numbers keep ringing.'
                    : 'Stay on this page to receive inbound calls on shared numbers.'
                )}
              </p>
            </div>
          </div>
        );

        if (targetSlot) {
          return createPortal(content, targetSlot);
        }

        return (
          <div
            className={`fixed bottom-28 left-4 z-[60] w-[min(360px,calc(100vw-2rem))] rounded-xl border px-4 py-3 shadow-2xl ${
              isErrorOrOffline
                ? 'border-amber-500/30 bg-[#1A1410]'
                : 'border-sky-500/25 bg-[#101A28]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">
                  {isErrorOrOffline ? 'Not receiving calls' : 'Connecting phone service'}
                </p>
                <p className="mt-1 text-xs text-gray-300">
                  {deviceError || (
                    deviceState === DEVICE_STATES.REFRESHING
                      ? 'Refreshing connection so shared numbers keep ringing.'
                      : 'Stay on this page to receive inbound calls on shared numbers.'
                  )}
                </p>
              </div>
              {isErrorOrOffline && (
                <button
                  type="button"
                  onClick={retryDeviceRegistration}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-[#1A1410] hover:bg-amber-400"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* =========================================================
          Minimized Floating Active Call Widget (With Quick Actions)
          ========================================================= */}
      {isCalling && isMinimized && (
        <div
          className="dialer-minimized-card fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-[#161B28]/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl text-white select-none pointer-events-auto"
        >
          <button
            type="button"
            onClick={restoreDialer}
            className="flex items-center gap-2.5 text-left hover:opacity-90 transition group min-w-0"
            title="Click to expand active call"
          >
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white truncate max-w-[130px]">
                  {phoneNumber || 'Active Call'}
                </span>
                <span className="text-[11px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                  {formatCallDuration(duration)}
                </span>
              </div>
              <span className="text-[10px] text-gray-400 block group-hover:text-gray-300 truncate">
                {callStatus} • Tap to expand
              </span>
            </div>
          </button>

          <div className="flex items-center gap-1.5 pl-2 border-l border-gray-700/80 shrink-0">
            <button
              type="button"
              onClick={toggleMute}
              className={`p-2 rounded-xl transition-all ${
                isMuted
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff className="w-4 h-4 text-amber-400" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={endCall}
              className="p-2 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white transition-all shadow-md shadow-red-600/30"
              title="End call"
            >
              <PhoneOff className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={restoreDialer}
              className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-all"
              title="Expand full dialer"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          Minimized Floating Idle Dialer Pill
          ========================================================= */}
      {!isCalling && isOpen && isMinimized && (
        <div
          className="dialer-minimized-card fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-2xl border border-gray-700/80 bg-[#161B28]/95 backdrop-blur-md px-3 py-2 shadow-2xl text-white select-none pointer-events-auto"
        >
          <button
            type="button"
            onClick={restoreDialer}
            className="flex items-center gap-2 text-left hover:text-emerald-400 transition"
            title="Open dialer"
          >
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold block text-white">Dialer</span>
              <span className="text-[10px] text-gray-400 block truncate max-w-[120px]">
                {phoneNumber || (isDeviceReady ? 'Ready' : 'Connecting...')}
              </span>
            </div>
          </button>

          <div className="flex items-center gap-1 pl-1 border-l border-gray-700/80 shrink-0">
            <button
              type="button"
              onClick={restoreDialer}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
              title="Expand dialer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMinimized(false);
                onClose?.();
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
              title="Close dialer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
          Expanded Floating Dialer Window (Draggable & Non-blocking)
          ========================================================= */}
      {shouldShowExpandedDialer && (
        <div
          ref={dialerRef}
          style={
            position
              ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
              : undefined
          }
          className={`dialer-floating-card fixed z-50 pointer-events-auto w-[360px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-gray-700/80 bg-[#161B28]/95 backdrop-blur-xl shadow-2xl shadow-black/60 text-white transition-shadow ${
            !position ? 'bottom-5 right-5 md:bottom-6 md:right-6' : ''
          } ${isDragging ? 'select-none ring-1 ring-emerald-500/40 shadow-emerald-950/40' : ''}`}
        >
          {/* Header Bar: Draggable with Drag Handle, Status, Title, Minimize & Close */}
          <div
            onMouseDown={handleHeaderMouseDown}
            onTouchStart={handleHeaderTouchStart}
            onDoubleClick={() => setPosition(null)}
            className="dialer-floating-header flex items-center justify-between border-b border-gray-700/70 px-4 py-3 cursor-grab active:cursor-grabbing select-none bg-[#1C2333]/70 rounded-t-2xl"
            title="Drag to reposition anywhere • Double-click to snap back to corner"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="text-gray-400 hover:text-gray-300 transition" title="Drag to move">
                <GripHorizontal className="w-4 h-4 opacity-70" />
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    isCalling
                      ? 'bg-emerald-400 animate-pulse'
                      : isDeviceReady
                        ? 'bg-emerald-500'
                        : 'bg-amber-400'
                  }`}
                />
                <h3 className="text-sm font-semibold truncate text-white">
                  {isCalling ? 'Active Call' : 'Phone Dialer'}
                </h3>
                {isCalling && (
                  <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 shrink-0">
                    {formatCallDuration(duration)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {position && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPosition(null);
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/60 transition"
                  title="Snap back to corner"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Minimize Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMinimizeDialer();
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/60 transition"
                title="Minimize dialer"
              >
                <Minus className="w-4 h-4" />
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseDialer();
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition"
                title={isCalling ? 'Minimize dialer' : 'Close dialer'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dialer Body */}
          <div className="p-4">
            <div className="w-full max-w-[280px] mx-auto">
              {/* In-Call Screen */}
              {isCalling ? (
                <div className="dialer-call-card rounded-2xl border border-gray-700/70 bg-gradient-to-br from-[#1A2333] to-[#121A2A] p-4 text-center shadow-inner">
                  <p className="text-base font-semibold text-white truncate mb-1">
                    {phoneNumber || 'Active Call'}
                  </p>

                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        callStatus === 'Connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-xs font-medium text-emerald-400">{callStatus}</span>
                  </div>

                  <div className="text-3xl font-mono font-light text-white mb-4 tracking-wider">
                    {formatCallDuration(duration)}
                  </div>

                  {/* DTMF Keypad View or Action Controls */}
                  {showKeypad ? (
                    <div className="mb-4">
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => sendDTMF(d)}
                            className="h-10 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-lg font-mono font-medium text-white transition active:scale-95 border border-gray-700/50"
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowKeypad(false)}
                        className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-gray-300 transition"
                      >
                        Hide Keypad
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {/* Mute Button */}
                      <button
                        type="button"
                        onClick={toggleMute}
                        className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border transition active:scale-95 ${
                          isMuted
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                            : 'bg-gray-800/80 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
                        }`}
                      >
                        {isMuted ? <MicOff className="w-4 h-4 text-amber-400" /> : <Mic className="w-4 h-4" />}
                        <span className="text-[10px] font-medium">{isMuted ? 'Unmute' : 'Mute'}</span>
                      </button>

                      {/* Speaker Button */}
                      <button
                        type="button"
                        onClick={toggleSpeaker}
                        className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border transition active:scale-95 ${
                          isSpeakerOn
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-gray-800/80 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
                        }`}
                      >
                        <Volume2 className="w-4 h-4" />
                        <span className="text-[10px] font-medium">Speaker</span>
                      </button>

                      {/* Hold Button */}
                      <button
                        type="button"
                        onClick={toggleHold}
                        className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border transition active:scale-95 ${
                          isOnHold
                            ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                            : 'bg-gray-800/80 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
                        }`}
                      >
                        {isOnHold ? <Play className="w-4 h-4 text-amber-400" /> : <Pause className="w-4 h-4" />}
                        <span className="text-[10px] font-medium">{isOnHold ? 'Resume' : 'Hold'}</span>
                      </button>

                      {/* Keypad Toggle Button */}
                      <button
                        type="button"
                        onClick={() => setShowKeypad(true)}
                        className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border bg-gray-800/80 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white transition active:scale-95"
                      >
                        <Hash className="w-4 h-4" />
                        <span className="text-[10px] font-medium">Keypad</span>
                      </button>
                    </div>
                  )}

                  {/* End Call Button */}
                  <button
                    type="button"
                    onClick={endCall}
                    className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 font-semibold text-white shadow-lg shadow-red-600/30 transition flex items-center justify-center gap-2 active:scale-98"
                  >
                    <PhoneOff className="w-5 h-5" />
                    <span>End Call</span>
                  </button>
                </div>
              ) : (
                /* Normal Idle Dialer Screen */
                <>
                  {!isDeviceReady && (
                    <div
                      className={`mb-3 rounded-xl border px-3 py-2 text-center text-xs ${
                        deviceState === DEVICE_STATES.ERROR || deviceState === DEVICE_STATES.OFFLINE
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                          : 'border-sky-500/25 bg-sky-500/10 text-sky-200'
                      }`}
                    >
                      <span className="font-medium">
                        {deviceState === DEVICE_STATES.REFRESHING
                          ? 'Refreshing phone connection…'
                          : deviceState === DEVICE_STATES.REGISTERING || deviceState === DEVICE_STATES.INITIALIZING
                            ? 'Connecting phone service…'
                            : 'Not receiving calls'}
                      </span>
                      {deviceError && (
                        <span className="mt-0.5 block text-[11px] text-amber-100/80">{deviceError}</span>
                      )}
                    </div>
                  )}

                  {/* Number Display Box */}
                  <div className="bg-[#161B28] border border-gray-700/80 rounded-2xl p-3.5 mb-4 text-center shadow-inner">
                    <p className="text-emerald-400 text-[10px] font-semibold tracking-widest uppercase mb-1">
                      United States • +1
                    </p>
                    <div className="text-2xl font-light font-mono text-white min-h-[36px] flex items-center justify-center tracking-wider break-all px-2">
                      {phoneNumber || <span className="text-gray-500 text-lg font-sans">Enter number</span>}
                    </div>
                  </div>

                  {/* Keypad Grid */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { key: '1', sub: '' },
                      { key: '2', sub: 'ABC' },
                      { key: '3', sub: 'DEF' },
                      { key: '4', sub: 'GHI' },
                      { key: '5', sub: 'JKL' },
                      { key: '6', sub: 'MNO' },
                      { key: '7', sub: 'PQRS' },
                      { key: '8', sub: 'TUV' },
                      { key: '9', sub: 'WXYZ' },
                      { key: '*', sub: '' },
                      { key: '0', sub: '+' },
                      { key: '#', sub: '' }
                    ].map(({ key, sub }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPhoneNumber((prev) => prev + key)}
                        className="h-12 bg-[#1F2937] hover:bg-[#374151] active:bg-[#4B5563] rounded-xl text-xl font-light text-white transition flex flex-col items-center justify-center active:scale-95 border border-gray-700/40"
                      >
                        <span className="leading-tight">{key}</span>
                        {sub && <span className="text-[9px] text-gray-400 font-medium tracking-wider">{sub}</span>}
                      </button>
                    ))}
                  </div>

                  {/* Action Row: Clear, Call, Backspace */}
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={() => setPhoneNumber('')}
                      disabled={!phoneNumber}
                      className="w-11 h-11 flex items-center justify-center bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:pointer-events-none rounded-full text-gray-300 hover:text-white transition"
                      title="Clear number"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={makeCall}
                      disabled={!phoneNumber.trim()}
                      className="w-14 h-14 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-700 disabled:opacity-40 rounded-full text-white shadow-xl shadow-emerald-500/30 transition-all active:scale-95"
                      title="Call"
                    >
                      <Phone className="w-6 h-6" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setPhoneNumber((prev) => prev.slice(0, -1))}
                      disabled={!phoneNumber}
                      className="w-11 h-11 flex items-center justify-center bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:pointer-events-none rounded-full text-gray-300 hover:text-white transition"
                      title="Backspace"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Dialer;
