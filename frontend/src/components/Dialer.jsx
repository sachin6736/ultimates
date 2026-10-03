import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Device } from '@twilio/voice-sdk';
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
const DIALER_ANIMATION_MS = 220;
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
  const [shouldRenderDialer, setShouldRenderDialer] = useState(isOpen);
  const [dialerMotion, setDialerMotion] = useState(isOpen ? 'open' : 'closed');
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
  const dialerAnimationRef = useRef(null);
  const incomingNotificationRef = useRef(null);
  const titleAlertRef = useRef(null);
  const originalTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');
  const ringtoneAudioRef = useRef(null);
    const deviceRef = useRef(null);
  const tokenRefreshRef = useRef(null);
  const retryDeviceRegistrationRef = useRef(async () => {});
  const shouldShowFullDialer = (isOpen || isCalling) && !isMinimized;
   const isDeviceReady = deviceState === DEVICE_STATES.READY;

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

  // Auto-fill from Contacts
  useEffect(() => {
    if (isOpen) setPhoneNumber(selectedPhoneNumber || '');
  }, [isOpen, selectedPhoneNumber]);

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

  useEffect(() => {
    const handlePaste = (event) => {
      if (!isOpen || isCalling || incomingCall) return;

      const pastedNumber = getDialableClipboardValue(event.clipboardData?.getData('text'));
      if (!pastedNumber) return;

      event.preventDefault();
      setPhoneNumber(pastedNumber);
      setIsMinimized(false);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [incomingCall, isCalling, isOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isOpen || isCalling || incomingCall) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

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
  }, [incomingCall, isCalling, isOpen]);

  useEffect(() => {
    clearTimeout(dialerAnimationRef.current);

    if (shouldShowFullDialer) {
      setShouldRenderDialer(true);
      setDialerMotion('opening');
      const frame = requestAnimationFrame(() => setDialerMotion('open'));
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(dialerAnimationRef.current);
      };
    }

    if (shouldRenderDialer) {
      setDialerMotion('closing');
      dialerAnimationRef.current = setTimeout(() => {
        setShouldRenderDialer(false);
      }, DIALER_ANIMATION_MS);
    }

    return () => clearTimeout(dialerAnimationRef.current);
  }, [shouldShowFullDialer, shouldRenderDialer]);

  // Duration Timer
  useEffect(() => {
    if (startTimeRef.current) {
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [isCalling]);
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
    // The Twilio Device should be created once for this mounted dialer.
    // Event handlers read current call data from refs to avoid re-registering.
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
    setDuration(0);
    startTimeRef.current = null;

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

      conn.on('accept', () => {
        setCallStatus('Connected');
        startTimeRef.current = Date.now();
        activeCallRef.current = {
          ...activeCallRef.current,
          accepted: true,
          callSid: conn?.parameters?.CallSid || activeCallRef.current?.callSid || ''
        };
      });

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
    setDuration(0);
    setConnection(null);
    setIsMuted(false);
    setIsOnHold(false);
    setIsSpeakerOn(false);
    setShowKeypad(false);
    setIsMinimized(false);
    setIsIncomingMinimized(false);
    startTimeRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleCloseDialer = () => {
    if (isCalling) {
      setDialerMotion('minimizing');
      clearTimeout(dialerAnimationRef.current);
      dialerAnimationRef.current = setTimeout(() => {
        setIsMinimized(true);
      }, DIALER_ANIMATION_MS);
      return;
    }

    setDialerMotion('closing');
    clearTimeout(dialerAnimationRef.current);
    dialerAnimationRef.current = setTimeout(() => {
      onClose?.();
    }, DIALER_ANIMATION_MS);
  };

  const restoreDialer = () => {
    clearTimeout(dialerAnimationRef.current);
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
      startTimeRef.current = Date.now();
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
      {/* Incoming Call Popup */}
      {incomingCall && !isIncomingMinimized && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] px-4">
          <div className="bg-[#1C2333] border border-gray-600 rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
            <div className="flex justify-end -mt-2 -mr-2 mb-1">
              <button
                onClick={() => setIsIncomingMinimized(true)}
                className="text-gray-400 hover:text-white text-xl"
                title="Minimize incoming call"
              >
                −
              </button>
            </div>
            <div className="text-4xl mb-4 animate-pulse">📲</div>
            <p className="text-red-400 text-lg font-semibold mb-1">Incoming Call</p>
            <p className="text-xl font-medium text-white mb-6 break-all">
              {incomingCall.from || 'Unknown Number'}
            </p>
            {incomingCall.lastHandledByName && (
              <div className="mb-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Recent company history</p>
                <p className="mt-1 text-sm text-white">
                  Last handled by {incomingCall.lastHandledByName}
                </p>
                {incomingCall.lastHandledAt && (
                  <p className="mt-0.5 text-xs text-gray-300">
                    {formatLastHandledAt(incomingCall.lastHandledAt)}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={rejectIncomingCall}
                className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-medium transition-all"
              >
                Reject
              </button>
              <button
                onClick={acceptIncomingCall}
                className="flex-1 py-3 bg-green-600 hover:bg-green-500 rounded-xl text-sm font-semibold transition-all"
              >
                Accept Call
              </button>
            </div>
          </div>
        </div>
      )}

      {incomingCall && isIncomingMinimized && (
        <div className="fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-emerald-500/30 bg-[#161B28] px-3 py-3 shadow-2xl">
          <button
            onClick={() => setIsIncomingMinimized(false)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span className="flex h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              <span className="block truncate text-sm font-semibold text-white">{incomingCall.from || 'Incoming call'}</span>
              <span className="block text-xs text-emerald-300">
                {incomingCall.lastHandledByName
                  ? `Last: ${incomingCall.lastHandledByName}`
                  : 'Incoming call'}
              </span>
            </span>
          </button>
          <button
            onClick={rejectIncomingCall}
            className="rounded-lg bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-600"
          >
            Reject
          </button>
          <button
            onClick={acceptIncomingCall}
            className="rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-500"
          >
            Accept
          </button>
        </div>
      )}
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
 
      {isCalling && isMinimized && (
        <button
          onClick={restoreDialer}
          className="dialer-minimized-card fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-emerald-500/30 bg-[#161B28] px-3 py-3 text-left shadow-2xl hover:bg-[#1C2333] transition"
        >
          <span className="flex h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            <span className="block truncate text-sm font-semibold text-white">{phoneNumber || 'Active call'}</span>
            <span className="block text-xs text-emerald-300">{callStatus}</span>
          </span>
        </button>
      )}

      {shouldRenderDialer && (
        <div className={`dialer-backdrop dialer-backdrop-${dialerMotion} fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-3 py-4`}>
          <div className={`dialer-panel dialer-panel-${dialerMotion} bg-[#161B28] border border-gray-700 rounded-2xl w-full max-w-[360px] shadow-2xl`}>
            <div className="flex justify-between items-center border-b border-gray-700 px-4 py-3">
              <h3 className="text-base font-semibold">{isCalling ? 'Active Call' : 'New Call'}</h3>
              <button
                onClick={handleCloseDialer}
                className="text-gray-400 hover:text-white text-xl"
                title={isCalling ? 'Minimize dialer' : 'Close dialer'}
              >
                {isCalling ? '−' : '✕'}
              </button>
            </div>

            <div className="p-4">
              <div className="w-full max-w-[270px] mx-auto">

        <div className={`mb-4 rounded-xl border px-3 py-2 text-center text-xs ${
        isDeviceReady
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/25 bg-amber-500/10 text-amber-200'
      }`}>
        <span className="font-medium">
          {isDeviceReady
            ? 'Ready to receive calls'
            : deviceState === DEVICE_STATES.REFRESHING
              ? 'Refreshing phone connection…'
              : deviceState === DEVICE_STATES.REGISTERING || deviceState === DEVICE_STATES.INITIALIZING
                ? 'Connecting phone service…'
                : 'Not receiving calls'}
        </span>
        {!isDeviceReady && deviceError && (
          <span className="mt-1 block text-[11px] text-amber-100/80">{deviceError}</span>
        )}
      </div>
 
      {/* Number Display */}
      <div className="bg-[#161B28] border border-gray-700 rounded-2xl p-4 mb-5 text-center">
        <p className="text-emerald-400 text-[11px] font-medium tracking-widest mb-1.5">UNITED STATES • +1</p>
        <div className="text-2xl font-light font-mono text-white min-h-[38px] flex items-center justify-center tracking-wider break-all">
          {phoneNumber}
        </div>
      </div>

      {/* In-Call Screen */}
      {isCalling ? (
        <div className="dialer-call-card bg-gradient-to-br from-[#1A2333] to-[#121A2A] border border-gray-700 rounded-2xl p-5 text-center">
          <p className="text-base font-medium text-white mb-1 break-all">{phoneNumber}</p>
          <p className={`text-sm text-emerald-400 font-medium ${showKeypad ? 'mb-2' : 'mb-4'}`}>{callStatus}</p>

          {startTimeRef.current && !showKeypad && (
            <p className="text-3xl font-mono font-light text-white mb-6">
              {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
            </p>
          )}

          <div className="min-h-[132px]">
            {showKeypad ? (
              <div className="grid grid-cols-3 gap-2">
                {['1','2','3','4','5','6','7','8','9','*','0','#'].map(d => (
                  <button
                    key={d}
                    onClick={() => sendDTMF(d)}
                    className="h-9 bg-gray-800 hover:bg-gray-700 rounded-lg text-lg transition-all hover:scale-105 active:scale-95"
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <button onClick={toggleMute} className="group p-3 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all hover:scale-105 active:scale-95 relative">
                  <div className="text-2xl">{isMuted ? '🔊' : '🔇'}</div>
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                    {isMuted ? 'Unmute' : 'Mute'}
                  </span>
                </button>

                <button onClick={toggleSpeaker} className="group p-3 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all hover:scale-105 active:scale-95 relative">
                  <div className="text-2xl">{isSpeakerOn ? '🔊' : '🎧'}</div>
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                    Speaker
                  </span>
                </button>

                <button onClick={toggleHold} className="group p-3 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all hover:scale-105 active:scale-95 relative">
                  <div className="text-2xl">{isOnHold ? '▶' : '⏸'}</div>
                  <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap">
                    {isOnHold ? 'Resume' : 'Hold'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className={`grid gap-2 ${showKeypad ? 'grid-cols-2 mt-3' : 'grid-cols-1'}`}>
            <button
              onClick={() => setShowKeypad(!showKeypad)}
              className={`${showKeypad ? 'py-2.5 text-xs' : 'py-3 text-sm'} bg-gray-800 hover:bg-gray-700 rounded-xl font-medium transition-all`}
            >
              {showKeypad ? 'Hide Keypad' : 'Show Keypad'} ⌨️
            </button>

            <button
              onClick={endCall}
              className={`${showKeypad ? 'py-2.5 text-xs' : 'py-3.5 text-sm'} bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-all`}
            >
              End Call
            </button>
          </div>
        </div>
      ) : (
        /* Normal Dialer */
        <>
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {['1','2','3','4','5','6','7','8','9','*','0','#'].map((key) => (
              <button
                key={key}
                onClick={() => setPhoneNumber(prev => prev + key)}
                className="h-12 bg-[#1F2937] hover:bg-[#374151] active:bg-[#4B5563] rounded-xl text-2xl font-light text-white transition-all active:scale-95"
              >
                {key}
              </button>
            ))}
          </div>

          <div className="flex justify-center gap-5">
            <button onClick={() => setPhoneNumber('')} className="w-11 h-11 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full text-2xl transition">✕</button>

            <button
              onClick={makeCall}
              disabled={!phoneNumber.trim()}
              className="w-16 h-16 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-600 rounded-full text-3xl shadow-xl shadow-emerald-500/30 transition-all active:scale-95"
            >
              📞
            </button>

            <button
              onClick={() => setPhoneNumber(prev => prev.slice(0, -1))}
              disabled={!phoneNumber}
              className="w-11 h-11 flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full text-2xl transition disabled:opacity-40"
            >
              ⌫
            </button>
          </div>
        </>
      )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Dialer;
