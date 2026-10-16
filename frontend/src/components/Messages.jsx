import { useCallback, useEffect, useState } from 'react';
import { Bot, Sparkles, User } from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import { buildPagedUrl, PAGE_SIZE, parsePagedResponse } from '../utils/pagination.js';
import { showErrorToast, showSuccessToast } from '../utils/toast.js';
import { formatPhoneNumber, normalizePhone, toStandardE164 } from '../utils/phone.js';

import { BACKEND_URL } from '../config/api.js';

const getUserId = (user) => String(user?.id || user?._id || '');
const getLeadId = (lead) => String((lead && typeof lead === 'object' ? lead._id : lead) || '');
const getUnreadSmsThreadsKey = (userId) => `unreadSmsThreads:${userId || 'unknown'}`;

const getUserDisplayName = (message) => {
  if (message.assigneeName) return message.assigneeName;
  if (typeof message.assignedTo === 'object' && message.assignedTo?.name) return message.assignedTo.name;
  if (message.userName) return message.userName;
  if (typeof message.user === 'object' && message.user?.name) return message.user.name;
  if (typeof message.assignedTo === 'object' && message.assignedTo?.email) return message.assignedTo.email;
  if (typeof message.user === 'object' && message.user?.email) return message.user.email;
  return '';
};

const messageStatusStyles = {
  delivered: 'bg-emerald-500/15 text-emerald-300',
  sent: 'bg-sky-500/15 text-sky-300',
  queued: 'bg-amber-500/15 text-amber-300',
  sending: 'bg-amber-500/15 text-amber-300',
  accepted: 'bg-amber-500/15 text-amber-300',
  undelivered: 'bg-red-500/15 text-red-300',
  failed: 'bg-red-500/15 text-red-300'
};

const formatMessageStatus = (status = '') => (
  status ? status.replace('-', ' ') : 'queued'
);

const normalizeIncomingMessage = (message) => ({
  ...message,
  phoneNumber: message.phoneNumber || message.from,
  direction: message.direction || 'inbound',
  status: message.status || 'received'
});

function MessagesSkeleton() {
  return (
    <AppSkeletonTheme>
      <div role="status" aria-label="Loading messages">
        <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <Skeleton width={126} height={16} />
          </div>
          <div className="divide-y divide-gray-800">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Skeleton width={132} height={16} />
                    <Skeleton width="84%" height={12} className="mt-2 block" />
                    <Skeleton width={86} height={18} className="mt-2 block" borderRadius={999} />
                  </div>
                  <Skeleton width={58} height={12} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppSkeletonTheme>
  );
}

function Messages({ selectedPhoneNumber = '', selectedLeadId = '', onRecipientUsed, currentUser }) {
  const [messageThreads, setMessageThreads] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [recipient, setRecipient] = useState(selectedPhoneNumber);
  const [leadId, setLeadId] = useState(selectedLeadId);
  const [body, setBody] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [suggestedMediaUrls, setSuggestedMediaUrls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showCompose, setShowCompose] = useState(Boolean(selectedPhoneNumber));
  const [unreadThreadKeys, setUnreadThreadKeys] = useState([]);

  const unreadStorageKey = getUnreadSmsThreadsKey(getUserId(currentUser));

  const readUnreadThreadKeys = useCallback(() => {
    try {
      const value = JSON.parse(localStorage.getItem(unreadStorageKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }, [unreadStorageKey]);

  const writeUnreadThreadKeys = useCallback((keys) => {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    localStorage.setItem(unreadStorageKey, JSON.stringify(uniqueKeys));
    setUnreadThreadKeys(uniqueKeys);
  }, [unreadStorageKey]);

  const upsertThread = useCallback((threads, message) => {
    const normalized = normalizeIncomingMessage(message);
    const phoneNumber = normalized.direction === 'outbound' ? normalized.to : normalized.from;
    const threadKey = normalizePhone(phoneNumber) || phoneNumber;
    const existingThread = threads.find((thread) => {
      const key = thread.threadKey || normalizePhone(thread.phoneNumber) || thread.phoneNumber;
      return key === threadKey;
    });

    const nextThread = {
      ...existingThread,
      ...normalized,
      userName: normalized.userName || normalized.user?.name || existingThread?.userName || '',
      assigneeName: normalized.assigneeName || normalized.assignedTo?.name || existingThread?.assigneeName || '',
      leadName: normalized.leadName || existingThread?.leadName || '',
      phoneNumber,
      threadKey
    };
    const remaining = threads.filter((thread) => {
      const key = thread.threadKey || normalizePhone(thread.phoneNumber) || thread.phoneNumber;
      return key !== threadKey;
    });

    return [nextThread, ...remaining];
  }, []);

  const fetchMessageThreads = useCallback(async ({ reset = false, before = null, silent = false } = {}) => {
    try {
      if (reset && !silent) {
        setLoading(true);
      } else if (!reset) {
        setLoadingMore(true);
      }

      const res = await fetch(buildPagedUrl(`${BACKEND_URL}/api/messages/threads`, {
        limit: PAGE_SIZE,
        before
      }), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load messages');

      const page = parsePagedResponse(data);
      setMessageThreads((current) => (reset ? page.items : [...current, ...page.items]));
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch (error) {
      if (reset && !silent) {
        showErrorToast(error.message || 'Failed to load messages');
      }
    } finally {
      if (reset && !silent) setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMoreThreads = useCallback(() => {
    if (!hasMore || loading || loadingMore || !nextBefore) return;
    fetchMessageThreads({ before: nextBefore });
  }, [fetchMessageThreads, hasMore, loading, loadingMore, nextBefore]);

  useEffect(() => {
    setUnreadThreadKeys(readUnreadThreadKeys());
  }, [readUnreadThreadKeys]);

  useEffect(() => {
    fetchMessageThreads({ reset: true });
  }, [fetchMessageThreads]);

  useEffect(() => {
    const handleIncomingMessage = (event) => {
      const incomingMessage = event.detail?.message;
      if (incomingMessage?.direction !== 'outbound') {
        const phoneNumber = incomingMessage?.from || incomingMessage?.phoneNumber;
        const threadKey = normalizePhone(phoneNumber) || phoneNumber;
        writeUnreadThreadKeys([...readUnreadThreadKeys(), threadKey]);
      }

      if (incomingMessage) {
        setMessageThreads((current) => upsertThread(current, incomingMessage));
        return;
      }

      fetchMessageThreads({ reset: true, silent: true });
    };

    window.addEventListener('refreshMessages', handleIncomingMessage);
    return () => window.removeEventListener('refreshMessages', handleIncomingMessage);
  }, [fetchMessageThreads, readUnreadThreadKeys, upsertThread, writeUnreadThreadKeys]);

  useEffect(() => {
    if (selectedPhoneNumber) {
      setRecipient(selectedPhoneNumber);
      setLeadId(selectedLeadId || '');
      setShowCompose(true);
      onRecipientUsed?.();
    }
  }, [selectedPhoneNumber, selectedLeadId, onRecipientUsed]);

  const draftAiMessage = async () => {
    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient && !leadId) {
      showErrorToast('Choose a recipient before drafting.');
      return;
    }

    try {
      setDrafting(true);
      const res = await fetch(`${BACKEND_URL}/api/messages/ai/draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          phoneNumber: trimmedRecipient,
          leadId: leadId || undefined,
          instruction: body.trim() || 'follow_up'
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to draft message');
      if (!data.draft) throw new Error(data.intent === 'opt_out' ? 'Lead may have opted out. Review conversation before messaging.' : 'AI did not return a draft.');

      setBody(data.draft);
      setSuggestedMediaUrls(Array.isArray(data.suggestedMediaUrls) ? data.suggestedMediaUrls : []);
      showSuccessToast(data.reason || 'AI draft ready. Review before sending.');
    } catch (error) {
      showErrorToast(error.message || 'Failed to draft message');
    } finally {
      setDrafting(false);
    }
  };
  const sendMessage = async (event) => {
    event.preventDefault();

    if (!recipient.trim() || (!body.trim() && !imageFile && suggestedMediaUrls.length === 0)) {
      showErrorToast('Add a recipient and message or image before sending.');
      return;
    }

    try {
      setSending(true);
      let mediaUrls = [...suggestedMediaUrls];

      if (imageFile) {
        const uploadRes = await fetch(`${BACKEND_URL}/api/messages/upload-image`, {
          method: 'POST',
          headers: {
            'Content-Type': imageFile.type,
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: imageFile
        });
        const uploadData = await uploadRes.json();

        if (!uploadRes.ok) throw new Error(uploadData.message || 'Failed to upload image');
        mediaUrls = [...mediaUrls, uploadData.mediaUrl];
      }

      const res = await fetch(`${BACKEND_URL}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          to: recipient.trim(),
          body: body.trim(),
          leadId: leadId || undefined,
          mediaUrls
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.code === 30034
          ? 'A2P 10DLC is not approved yet for this sender.'
          : data.message || 'Failed to send message');
      }

      setBody('');
      setImageFile(null);
      setSuggestedMediaUrls([]);
      showSuccessToast((imageFile || suggestedMediaUrls.length > 0) ? 'Image message queued successfully' : 'Message queued successfully');
      if (data.messageLog) {
        setMessageThreads((current) => upsertThread(current, data.messageLog));
      } else {
        fetchMessageThreads({ reset: true, silent: true });
      }
    } catch (error) {
      showErrorToast(error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const formatDateTime = (date) => {
    const value = new Date(date);
    return `${value.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })} ${value.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  };

  const getAllottedNumberLabel = (message) => {
    const allottedNumber = message.direction === 'outbound' ? message.from : message.to;
    if (!allottedNumber) return '';

    const formatted = formatPhoneNumber(allottedNumber);
    return message.direction === 'outbound'
      ? `From ${formatted}`
      : `To ${formatted}`;
  };

  const openConversation = (phoneNumber, nextLeadId = '') => {
    const threadKey = normalizePhone(phoneNumber) || phoneNumber;
    writeUnreadThreadKeys(unreadThreadKeys.filter((key) => key !== threadKey));
    window.dispatchEvent(new CustomEvent('openConversation', {
      detail: { phoneNumber, leadId: nextLeadId }
    }));
  };

  if (loading) {
    return (
      <div className="messages-page max-w-3xl mx-auto">
        <MessagesSkeleton />
      </div>
    );
  }

  return (
    <div className="messages-page max-w-3xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Messages</h2>
          <p className="mt-0.5 text-xs text-gray-400">Recent SMS conversations</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCompose((current) => !current)}
          className="rounded-xl bg-[#059669] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#047857]"
        >
          {showCompose ? 'Close SMS' : 'Create SMS'}
        </button>
      </div>

      {showCompose && (
        <form onSubmit={sendMessage} className="mb-4 rounded-2xl border border-gray-700 bg-gray-900 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <label className="mb-1.5 block text-xs text-gray-400">To</label>
              <input
                type="tel"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="+1..."
                className="h-10 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 text-sm text-white focus:border-[#059669]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2 self-end">
              <button
                type="button"
                onClick={draftAiMessage}
                disabled={drafting || sending || (!recipient.trim() && !leadId)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
              >
                {drafting ? <InlineLoader label="Drafting..." /> : <><Sparkles className="h-4 w-4" aria-hidden="true" /> AI Draft</>}
              </button>
              <button
                type="submit"
                disabled={sending}
                className="rounded-xl bg-[#059669] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
              >
                {sending ? <InlineLoader label="Sending..." /> : 'Send SMS'}
              </button>
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1.5 block text-xs text-gray-400">Message</label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={2}
              maxLength={1600}
              placeholder="Write a message..."
              className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-[#059669]"
            />
            <div className="mt-1 text-right text-[11px] text-gray-500">{body.length}/1600</div>
          </div>

          <div className="mt-3 rounded-xl border border-dashed border-gray-700 bg-gray-800/60 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-300">Image</p>
                <p className="mt-1 truncate text-[11px] text-gray-500">
                  {imageFile ? imageFile.name : suggestedMediaUrls.length > 0 ? `${suggestedMediaUrls.length} AI photo(s) attached` : 'Attach JPG, PNG, GIF, or WebP'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(imageFile || suggestedMediaUrls.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageFile(null);
                      setSuggestedMediaUrls([]);
                    }}
                    className="rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
                  >
                    Remove
                  </button>
                )}
                <label className="cursor-pointer rounded-lg bg-gray-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-gray-600">
                  Choose Image
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="sr-only"
                    onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                  />
                </label>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Recent Messages</h3>
          {unreadThreadKeys.length > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
              {unreadThreadKeys.length} unread
            </span>
          )}
        </div>

        {messageThreads.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">No messages yet.</p>
        ) : (
          <div className="divide-y divide-gray-800">
            {messageThreads.map((message) => {
              const isUnread = unreadThreadKeys.includes(message.threadKey);
              const lastMessage = String(message.body || '').trim()
                || (message.mediaUrls?.length ? 'Image message' : 'No message text');

              return (
                <button
                  key={message._id || message.messageSid}
                  type="button"
                  onClick={() => openConversation(message.phoneNumber, getLeadId(message.lead))}
                  className="block w-full px-4 py-3 text-left transition hover:bg-[#1F2533]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                        {isUnread && (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" aria-label="Unread message" />
                        )}
                        <span className={`truncate text-sm font-semibold ${
                          isUnread ? 'text-white' : 'text-gray-200'
                        }`}>
                          {message.leadName || formatPhoneNumber(message.phoneNumber)}
                        </span>
                        {message.leadName && (
                          <span className="truncate text-xs text-gray-400">
                            ({formatPhoneNumber(message.phoneNumber)})
                          </span>
                        )}
                      </div>

                      <p className={`mt-1 line-clamp-1 text-xs ${
                        isUnread ? 'font-semibold text-gray-200' : 'text-gray-400'
                      }`}>
                        {message.direction === 'outbound' ? (message.senderType === 'ai' ? 'AI: ' : 'You: ') : ''}
                        {lastMessage}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {message.direction === 'outbound' ? (
                          message.senderType === 'ai' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[11px] font-semibold text-purple-300">
                              <Bot className="h-3 w-3 shrink-0 text-purple-400" />
                              <span>AI Message</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
                              <User className="h-3 w-3 shrink-0 text-blue-400" />
                              <span>User Message</span>
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-700 px-2 py-0.5 text-[11px] font-semibold text-gray-300">
                            Received
                          </span>
                        )}

                        {message.direction === 'outbound' && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            messageStatusStyles[message.status] || messageStatusStyles.queued
                          }`}>
                            {formatMessageStatus(message.status)}
                          </span>
                        )}

                        {getAllottedNumberLabel(message) && (
                          <span className="truncate text-xs text-gray-500">
                            {getAllottedNumberLabel(message)}
                          </span>
                        )}

                        {getUserDisplayName(message) && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/20" title={`Assignee: ${getUserDisplayName(message)}`}>
                            <User className="h-3 w-3 shrink-0" />
                            <span>{getUserDisplayName(message)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {formatDateTime(message.createdAt)}
                      </span>
                      {getUserDisplayName(message) && (
                        <p className="mt-1 hidden sm:flex items-center justify-end gap-1 text-xs font-medium text-emerald-400" title={`Assignee: ${getUserDisplayName(message)}`}>
                          <User className="h-3 w-3 shrink-0 opacity-75" />
                          <span className="truncate max-w-[120px] sm:max-w-[160px]">{getUserDisplayName(message)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && hasMore && (
          <div className="px-4 py-4 text-center">
            <button
              type="button"
              onClick={loadMoreThreads}
              disabled={loadingMore}
              className="rounded-xl border border-gray-700 bg-[#0F141F] px-4 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-600 hover:bg-[#1F2533] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more conversations'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Messages;
