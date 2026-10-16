import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BACKEND_URL } from '../config/api.js';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import { showErrorToast } from '../utils/toast.js';

const getUserId = (user) => String(user?._id || user?.id || '');

const formatTime = (date) => new Date(date).toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit'
});

const upsertMessage = (messages, message) => {
  if (!message?._id && !message?.messageId) return messages;

  const messageId = String(message._id || message.messageId);
  const exists = messages.some((item) => String(item._id || item.messageId) === messageId);

  return exists ? messages : [...messages, message];
};

function TeamUsersSkeleton() {
  return (
    <AppSkeletonTheme>
      <div className="space-y-2" role="status" aria-label="Loading team users">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="rounded-xl border border-gray-800 bg-gray-900 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton width={132} height={16} />
                <Skeleton width={74} height={12} className="mt-2 block" />
                <Skeleton width="82%" height={12} className="mt-2 block" />
              </div>
              <Skeleton width={10} height={10} borderRadius={999} />
            </div>
          </div>
        ))}
      </div>
    </AppSkeletonTheme>
  );
}

function TeamConversationSkeleton() {
  return (
    <AppSkeletonTheme>
      <div className="space-y-3" role="status" aria-label="Loading team conversation">
        <div className="flex justify-start">
          <div className="w-[58%] rounded-xl bg-gray-800 px-3 py-2">
            <Skeleton width="86%" height={14} />
            <Skeleton width={52} height={10} className="mt-2 block" />
          </div>
        </div>
        <div className="flex justify-end">
          <div className="w-[68%] rounded-xl bg-emerald-700/50 px-3 py-2">
            <Skeleton width="92%" height={14} />
            <Skeleton width={48} height={10} className="ml-auto mt-2 block" />
          </div>
        </div>
        <div className="flex justify-start">
          <div className="w-[50%] rounded-xl bg-gray-800 px-3 py-2">
            <Skeleton width="78%" height={14} />
            <Skeleton width={44} height={10} className="mt-2 block" />
          </div>
        </div>
      </div>
    </AppSkeletonTheme>
  );
}

function InternalMessages({
  currentUser,
  selectedUserId = '',
  onSelectUser,
  onReadMessages
}) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
  }), []);

  const fetchUsers = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoadingUsers(true);
      const res = await fetch(`${BACKEND_URL}/api/internal-messages/users`, {
        headers: authHeaders
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to load chat users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      showErrorToast(error.message || 'Failed to load chat users');
    } finally {
      if (!silent) setLoadingUsers(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const refresh = () => {
      fetchUsers({ silent: true });
      onReadMessages?.();
    };

    window.addEventListener('refreshInternalMessages', refresh);
    return () => window.removeEventListener('refreshInternalMessages', refresh);
  }, [fetchUsers, onReadMessages]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Team Chat</h2>
        <p className="mt-0.5 text-xs text-gray-400">Select a teammate to open the conversation on the right.</p>
      </div>

      {loadingUsers ? (
        <TeamUsersSkeleton />
      ) : users.length === 0 ? (
        <p className="rounded-2xl border border-gray-800 bg-gray-900 py-10 text-center text-sm text-gray-400">
          No users available.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
          <div className="divide-y divide-gray-800">
            {users.map((user) => {
              const userId = getUserId(user);
              const active = userId === selectedUserId;
              const hasUnread = Number(user.unreadCount) > 0;

              return (
                <button
                  key={userId}
                  type="button"
                  onClick={() => onSelectUser?.(user)}
                  className={`block w-full px-4 py-3 text-left transition ${
                    active ? 'bg-emerald-500/10' : 'hover:bg-[#1F2533]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        {hasUnread && (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" aria-label="Unread team messages" />
                        )}
                        <span className="truncate text-sm font-semibold text-white">{user.name}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] capitalize text-gray-500">{user.role}</p>
                      {user.lastMessagePreview && (
                        <p className={`mt-1 line-clamp-1 text-xs ${hasUnread ? 'font-semibold text-gray-200' : 'text-gray-400'}`}>
                          {user.lastMessagePreview}
                        </p>
                      )}
                    </div>
                    {hasUnread && (
                      <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                        {user.unreadCount > 99 ? '99+' : user.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InternalMessageDetails({
  currentUser,
  selectedUser,
  onReadMessages,
  onBack
}) {
  const selectedUserId = getUserId(selectedUser);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
  }), []);

  const fetchConversation = useCallback(async ({ silent = false } = {}) => {
    if (!selectedUserId) {
      setMessages([]);
      return;
    }

    try {
      if (!silent) setLoadingMessages(true);
      const res = await fetch(`${BACKEND_URL}/api/internal-messages/${selectedUserId}`, {
        headers: authHeaders
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to load conversation');
      setMessages(Array.isArray(data) ? data : []);
      onReadMessages?.();
      window.dispatchEvent(new Event('refreshInternalMessages'));
    } catch (error) {
      showErrorToast(error.message || 'Failed to load conversation');
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [authHeaders, onReadMessages, selectedUserId]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  useEffect(() => {
    const refresh = (event) => {
      const message = event.detail;
      const senderId = getUserId(message?.sender);
      const recipientId = getUserId(message?.recipient);

      if (!selectedUserId || (senderId !== selectedUserId && recipientId !== selectedUserId)) return;

      if (message?.body) {
        setMessages((current) => upsertMessage(current, message));
        onReadMessages?.();
        window.dispatchEvent(new Event('refreshInternalMessages'));
        return;
      }

      fetchConversation({ silent: true });
    };

    window.addEventListener('refreshInternalMessages', refresh);
    return () => window.removeEventListener('refreshInternalMessages', refresh);
  }, [fetchConversation, selectedUserId]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [messages]);

  const sendMessage = async (event) => {
    event.preventDefault();

    if (!selectedUserId || !body.trim()) {
      showErrorToast('Choose a user and write a message.');
      return;
    }

    try {
      setSending(true);
      const res = await fetch(`${BACKEND_URL}/api/internal-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          recipientId: selectedUserId,
          body: body.trim()
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to send message');
      setBody('');
      setMessages((current) => upsertMessage(current, data));
      window.dispatchEvent(new CustomEvent('refreshInternalMessages', {
        detail: data
      }));
    } catch (error) {
      showErrorToast(error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (!selectedUserId) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-500">
        Select a teammate from Team Chat to view the conversation.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0F1322]">
      <div className="flex items-center gap-3 border-b border-gray-800 bg-[#161B28] px-4 py-3 sm:px-5 sm:py-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-700 bg-gray-800 text-gray-300 transition hover:bg-gray-700 hover:text-white lg:hidden shrink-0"
            aria-label="Back"
            title="Back to team list"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{selectedUser.name}</p>
          <p className="truncate text-xs text-gray-400">{selectedUser.email || 'Team conversation'}</p>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-3 sm:p-5 thin-scrollbar">
        {loadingMessages ? (
          <TeamConversationSkeleton />
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">No team messages yet.</p>
        ) : (
          messages.map((message) => {
            const mine = getUserId(message.sender) === getUserId(currentUser);

            return (
              <div key={message._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[78%] rounded-xl px-3 py-2 ${
                  mine
                    ? 'internal-message-outbound bg-[#059669] text-white'
                    : 'internal-message-inbound bg-gray-800 text-white'
                }`}>
                  <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                  <p className={`internal-message-time mt-1 text-[10px] ${mine ? 'text-emerald-50/80' : 'text-gray-500'}`}>
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={sendMessage} className="border-t border-gray-800 bg-[#161B28] p-3 sm:p-4">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Write a team message..."
          className="w-full resize-none rounded-xl border border-gray-700 bg-[#0F1322] px-3.5 py-2.5 sm:px-4 sm:py-3 text-sm text-white focus:border-[#059669]"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-500">{body.length}/2000</span>
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="rounded-xl bg-[#059669] px-4 py-2 sm:px-5 sm:py-2.5 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
          >
            {sending ? <InlineLoader label="Sending..." /> : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

export { InternalMessageDetails };
export default InternalMessages;
