import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Phone, Search, Sparkles, User, X } from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import { buildPagedUrl, PAGE_SIZE, parsePagedResponse } from '../utils/pagination.js';
import { showCopiedNumberToast, showErrorToast } from '../utils/toast.js';
import { formatPhoneNumber, normalizePhone, toStandardE164 } from '../utils/phone.js';
import { BACKEND_URL } from '../config/api.js';
import { decryptPayload } from '../utils/cryptoPayload.js';

const messageStatusStyles = {
  delivered: 'text-emerald-300',
  sent: 'text-sky-300',
  queued: 'text-amber-300',
  sending: 'text-amber-300',
  accepted: 'text-amber-300',
  undelivered: 'text-red-300',
  failed: 'text-red-300'
};

const formatMessageStatus = (status = '') => (
  status ? status.replace('-', ' ') : 'queued'
);

const upsertTimelineItem = (timeline, item) => {
  if (!item?.id) return timeline;
  const exists = timeline.some((entry) => entry.id === item.id);
  return exists ? timeline : [...timeline, item];
};

const normalizeIncomingMessage = (message) => ({
  ...message,
  phoneNumber: message.phoneNumber || message.from,
  direction: message.direction || 'inbound',
  status: message.status || 'received'
});

const toTimelineMessage = (message) => ({
  id: String(message._id || message.messageSid || message.id || ''),
  type: 'sms',
  direction: message.direction,
  senderType: message.senderType || (message.direction === 'outbound' ? (message.userName ? 'human' : 'ai') : 'customer'),
  status: message.status,
  errorCode: message.errorCode,
  deliveredAt: message.deliveredAt,
  from: message.from,
  to: message.to,
  body: message.body,
  mediaUrls: message.mediaUrls || [],
  date: message.createdAt || message.date,
  userName: message.userName || (typeof message.user === 'object' ? message.user?.name : '') || message.assigneeName || (typeof message.assignedTo === 'object' ? message.assignedTo?.name : '') || '',
  assigneeName: message.assigneeName || (typeof message.assignedTo === 'object' ? message.assignedTo?.name : '') || ''
});

function ConversationDetailsSkeleton() {
  return (
    <AppSkeletonTheme>
      <div role="status" aria-label="Loading conversation">
        <div className="mb-5 flex justify-center">
          <Skeleton width={96} height={24} borderRadius={999} />
        </div>

        <div className="space-y-3">
          <div className="flex justify-start">
            <div className="conversation-skeleton-inbound w-[68%] rounded-2xl bg-[#1C2333] px-4 py-3 shadow-lg">
              <Skeleton width={118} height={16} />
              <Skeleton width="72%" height={12} className="mt-2 block" />
              <div className="mt-3 flex items-center justify-between gap-4">
                <Skeleton width={72} height={12} />
                <Skeleton width={48} height={12} />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="conversation-skeleton-outbound w-[74%] rounded-2xl bg-[#1E293B] px-4 py-3 shadow-lg">
              <Skeleton width="88%" height={14} />
              <Skeleton width="64%" height={14} className="mt-2 block" />
              <div className="mt-3 flex items-center justify-between gap-4">
                <Skeleton width={48} height={12} />
                <Skeleton width={52} height={12} />
              </div>
            </div>
          </div>

          <div className="flex justify-start">
            <div className="conversation-skeleton-inbound w-[62%] rounded-2xl bg-[#1C2333] px-4 py-3 shadow-lg">
              <Skeleton width={104} height={16} />
              <Skeleton width="58%" height={12} className="mt-2 block" />
              <div className="mt-3 flex items-center justify-between gap-4">
                <Skeleton width={64} height={12} />
                <Skeleton width={44} height={12} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppSkeletonTheme>
  );
}

function ConversationDetails({ phoneNumber, leadId = '', onClose }) {
  const [timeline, setTimeline] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [messageBody, setMessageBody] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [suggestedMediaUrls, setSuggestedMediaUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showQuotePicker, setShowQuotePicker] = useState(false);
  const [partSearch, setPartSearch] = useState('');
  const [quoteParts, setQuoteParts] = useState([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [notice, setNotice] = useState('');
  const timelineEndRef = useRef(null);
  const scrollRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);

  const selectedDigits = normalizePhone(phoneNumber);

  const fetchConversation = useCallback(async ({ reset = false, before = null, silent = false } = {}) => {
    if (!phoneNumber) return;

    try {
      if (reset && !silent) {
        setLoading(true);
        setNotice('');
      } else if (!reset) {
        setLoadingMore(true);
      }

      const scrollContainer = scrollRef.current;
      const previousHeight = reset ? 0 : (scrollContainer?.scrollHeight || 0);
      const previousTop = scrollContainer?.scrollTop || 0;

      const res = await fetch(buildPagedUrl(`${BACKEND_URL}/api/conversations/timeline`, {
        limit: PAGE_SIZE,
        before,
        extraParams: { phoneNumber }
      }), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load conversation');

      const page = parsePagedResponse(data);

      setTimeline((current) => {
        if (reset) return page.items;
        const existingIds = new Set(current.map((item) => item.id));
        const olderItems = page.items.filter((item) => !existingIds.has(item.id));
        return [...olderItems, ...current];
      });
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);

      if (!reset && scrollContainer) {
        requestAnimationFrame(() => {
          const nextHeight = scrollContainer.scrollHeight;
          scrollContainer.scrollTop = previousTop + (nextHeight - previousHeight);
        });
      }
    } catch (error) {
      if (reset && !silent) setNotice(error.message);
    } finally {
      if (reset && !silent) setLoading(false);
      setLoadingMore(false);
    }
  }, [phoneNumber]);

  const loadOlderTimeline = useCallback(() => {
    if (!hasMore || loading || loadingMore || !nextBefore) return;
    shouldStickToBottomRef.current = false;
    fetchConversation({ before: nextBefore });
  }, [fetchConversation, hasMore, loading, loadingMore, nextBefore]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setTimeline([]);
    setHasMore(false);
    setNextBefore(null);
    fetchConversation({ reset: true });
  }, [fetchConversation, phoneNumber]);

  useEffect(() => {
    const refreshConversation = () => fetchConversation({ reset: true, silent: true });
    const refreshMessages = (event) => {
      const message = event.detail?.message;
      if (!message) {
        refreshConversation();
        return;
      }

      const values = [message.phoneNumber, message.from, message.to].map(normalizePhone);
      if (!values.includes(selectedDigits)) return;

      const timelineMessage = toTimelineMessage(normalizeIncomingMessage(message));
      setTimeline((current) => upsertTimelineItem(current, timelineMessage));
      shouldStickToBottomRef.current = true;
    };

    window.addEventListener('refreshCallHistory', refreshConversation);
    window.addEventListener('refreshMessages', refreshMessages);
    return () => {
      window.removeEventListener('refreshCallHistory', refreshConversation);
      window.removeEventListener('refreshMessages', refreshMessages);
    };
  }, [fetchConversation, selectedDigits]);

  const formatDate = (date) => new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const formatTime = (date) => new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  const formatDuration = (seconds) => {
    const value = Number(seconds) || 0;
    const minutes = Math.floor(value / 60);
    const secs = value % 60;
    return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  };

  const getAllottedNumberLabel = (item) => {
    if (item.type === 'call') {
      if (!item.localNumber) return '';
      const formattedLocal = formatPhoneNumber(item.localNumber);
      return item.direction === 'outbound'
        ? `From ${formattedLocal}`
        : `To ${formattedLocal}`;
    }

    const allottedNumber = item.direction === 'outbound' ? item.from : item.to;
    if (!allottedNumber) return '';

    const formattedAllotted = formatPhoneNumber(allottedNumber);
    return item.direction === 'outbound'
      ? `From ${formattedAllotted}`
      : `To ${formattedAllotted}`;
  };

  const groupedTimeline = useMemo(() => timeline.reduce((groups, item) => {
    const key = formatDate(item.date);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {}), [timeline]);

  useEffect(() => {
    if (!loading && phoneNumber && shouldStickToBottomRef.current) {
      timelineEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [loading, phoneNumber, timeline.length]);

  const handleCall = () => {
    window.dispatchEvent(new CustomEvent('callContact', {
      detail: { phoneNumber }
    }));
  };

  const handleCopyNumber = async () => {
    if (!phoneNumber) return;

    try {
      await navigator.clipboard.writeText(phoneNumber);
      showCopiedNumberToast({
        phoneNumber: formatPhoneNumber(phoneNumber),
        onPaste: () => window.dispatchEvent(new CustomEvent('pasteNumberOnDialer', {
          detail: { phoneNumber }
        }))
      });
    } catch {
      showErrorToast('Failed to copy phone number');
    }
  };

  const draftAiMessage = async () => {
    if (!phoneNumber && !leadId) {
      setNotice('Choose a conversation before drafting.');
      return;
    }

    try {
      setDrafting(true);
      setNotice('');
      const res = await fetch(`${BACKEND_URL}/api/messages/ai/draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          phoneNumber,
          leadId: leadId || undefined,
          instruction: messageBody.trim() || 'follow_up'
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to draft message');
      if (!data.draft) throw new Error(data.intent === 'opt_out' ? 'Lead may have opted out. Review conversation before messaging.' : 'AI did not return a draft.');

      setMessageBody(data.draft);
      setSuggestedMediaUrls(Array.isArray(data.suggestedMediaUrls) ? data.suggestedMediaUrls : []);
      setNotice(data.reason || 'AI draft ready. Review before sending.');
    } catch (error) {
      setNotice(error.message || 'Failed to draft message');
    } finally {
      setDrafting(false);
    }
  };

  const sendMessage = async (event) => {
    const isQuote = typeof event === 'string';
    if (!isQuote) event?.preventDefault?.();
    const trimmedBody = (isQuote ? event : messageBody).trim();
    if (!trimmedBody && !imageFile && suggestedMediaUrls.length === 0) return;

    try {
      setSending(true);
      setNotice('');

      let mediaUrls = isQuote ? [] : [...suggestedMediaUrls];

      if (imageFile && !isQuote) {
        const uploadRes = await fetch(`${BACKEND_URL}/api/messages/upload-image`, {
          method: 'POST',
          headers: {
            'Content-Type': imageFile.type,
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: imageFile
        });

        const uploadData = await uploadRes.json();

        if (!uploadRes.ok) {
          throw new Error(uploadData.message || 'Failed to upload image');
        }

        mediaUrls = [...mediaUrls, uploadData.mediaUrl];
      }

      const res = await fetch(`${BACKEND_URL}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          to: phoneNumber,
          body: trimmedBody,
          leadId: leadId || undefined,
          mediaUrls
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send message');

      setMessageBody('');
      setImageFile(null);
      setSuggestedMediaUrls([]);
      if (data.messageLog) {
        const timelineMessage = toTimelineMessage(data.messageLog);
        setTimeline((current) => upsertTimelineItem(current, timelineMessage));
        shouldStickToBottomRef.current = true;
        window.dispatchEvent(new CustomEvent('refreshMessages', {
          detail: { message: data.messageLog }
        }));
      } else {
        fetchConversation({ reset: true, silent: true });
        window.dispatchEvent(new Event('refreshMessages'));
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!showQuotePicker) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setLoadingParts(true);
        const params = new URLSearchParams({ status: 'active', limit: '50' });
        if (partSearch.trim()) params.set('search', partSearch.trim());
        const response = await fetch(`${BACKEND_URL}/api/services?${params}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: controller.signal
        });
        const raw = await response.json();
        if (!response.ok) throw new Error(raw.message || 'Could not load services');
        const data = raw.encrypted ? decryptPayload(raw.payload) : raw;
        if (!data) throw new Error('Could not read the services catalog');
        const list = Array.isArray(data.services) ? data.services : (Array.isArray(data.parts) ? data.parts : []);
        setQuoteParts(list);
      } catch (error) {
        if (error.name !== 'AbortError') setNotice(error.message || 'Could not load services');
      } finally {
        if (!controller.signal.aborted) setLoadingParts(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [showQuotePicker, partSearch]);

  const sendServiceQuote = (service) => {
    const title = service.name;
    const deliverables = Array.isArray(service.deliverables) && service.deliverables.length
      ? `Includes: ${service.deliverables.slice(0, 3).join(', ')}.`
      : '';
    const quote = `Quote for ${title}: Pricing starts from ${service.currency || 'USD'} ${Number(service.price).toFixed(2)}.${deliverables ? ` ${deliverables}` : ''} Reply if you would like more details or have any questions!`;
    setShowQuotePicker(false);
    setMessageBody(quote);
    setNotice('');
  };

  if (!phoneNumber) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-500">
        Select a phone number from calls or messages to view the full conversation.
      </div>
    );
  }

  return (
    <div className="conversation-details-panel flex h-full min-h-0 flex-col bg-[#0F1322]">
      <div className="conversation-header border-b border-gray-800 bg-[#161B28] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={handleCopyNumber}
              className="conversation-title truncate text-left text-xl font-semibold text-white hover:text-emerald-300"
              title="Copy number"
            >
              {formatPhoneNumber(phoneNumber)}
            </button>
            <p className="conversation-subtitle mt-1 text-xs text-gray-400">
              {timeline.length} loaded interaction{timeline.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCall}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-500"
              title="Call"
              aria-label="Call"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="conversation-close-btn rounded-xl border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-800 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-auto px-5 py-4">
        {loading && <ConversationDetailsSkeleton />}

        {!loading && hasMore && (
          <div className="mb-4 text-center">
            <button
              type="button"
              onClick={loadOlderTimeline}
              disabled={loadingMore}
              className="conversation-load-more rounded-xl border border-gray-700 bg-[#161B28] px-4 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-600 hover:bg-[#1F2533] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load older activity'}
            </button>
          </div>
        )}

        {!loading && timeline.length === 0 && (
          <p className="conversation-empty py-10 text-center text-sm text-gray-400">No calls or messages found for this number.</p>
        )}

        {!loading && Object.entries(groupedTimeline).map(([date, items]) => (
          <div key={date}>
            <div className="mb-4 mt-2 flex justify-center">
              <span className="conversation-date-pill rounded-full border border-gray-700 bg-[#161B28] px-3 py-1 text-xs text-gray-300">
                {date}
              </span>
            </div>

            <div className="space-y-3">
              {items.map((item) => {
                const isOutbound = item.direction === 'outbound';
                const isCall = item.type === 'call';
                const isAiMessage = !isCall && isOutbound && (item.senderType === 'ai' || (!item.userName && !item.assigneeName));
                const isUserMessage = !isCall && isOutbound && !isAiMessage;
                const allottedNumberLabel = getAllottedNumberLabel(item);
                const handledByName = item.handledByName || item.answeredByName || item.userName || '';
                const callStatusLabel = item.status === 'answered-by-teammate' && handledByName
                  ? `Answered by ${handledByName}`
                  : item.isConsolidated && item.status === 'completed' && handledByName
                    ? `Answered by ${handledByName}`
                    : (item.status || 'completed').replace(/-/g, ' ');

                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[76%] rounded-2xl px-4 py-3 shadow-lg ${
                      isCall
                        ? 'conversation-call-bubble bg-[#1C2333] text-white'
                        : isAiMessage
                          ? 'conversation-sms-ai bg-[#1A1829] border border-purple-500/30 text-white shadow-purple-950/20'
                          : isUserMessage
                            ? 'conversation-sms-outbound bg-[#1E293B] border border-blue-500/20 text-white shadow-blue-950/20'
                            : 'conversation-sms-inbound bg-[#374151] text-white'
                    }`}>
                      {isCall ? (
                        <>
                          <p className="conversation-call-direction text-sm font-semibold capitalize">{item.direction} call</p>
                          <p className={`conversation-call-status mt-1 text-xs capitalize ${
                            item.status === 'answered-by-teammate' || (item.isConsolidated && item.status === 'completed' && handledByName)
                              ? 'font-semibold text-emerald-400'
                              : 'text-gray-300'
                          }`}>
                            {callStatusLabel}
                          </p>
                          <p className="conversation-call-duration mt-1 text-xs text-gray-400">{formatDuration(item.duration)}</p>
                        </>
                      ) : (
                        <>
                          {/* Sender Identification Badge */}
                          <div className="conversation-bubble-header mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
                            {isAiMessage ? (
                              <span className="conversation-badge-ai inline-flex items-center gap-1.5 rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-300 border border-purple-500/30">
                                <Bot className="h-3 w-3 text-purple-400" />
                                <span>AI Assistant</span>
                              </span>
                            ) : isUserMessage ? (
                              <span className="conversation-badge-user inline-flex items-center gap-1.5 rounded-md bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300 border border-blue-500/30">
                                <User className="h-3 w-3 text-blue-400" />
                                <span>User: {item.userName || item.assigneeName || 'Representative'}</span>
                              </span>
                            ) : (
                              <span className="conversation-badge-customer inline-flex items-center gap-1 rounded-md bg-gray-700/80 px-2 py-0.5 text-[10px] font-semibold text-gray-300 border border-gray-600/30">
                                Customer
                              </span>
                            )}
                            <span className="conversation-time text-[10px] font-mono text-gray-400">{formatTime(item.date)}</span>
                          </div>

                          {item.mediaUrls?.length > 0 && (
                            <div className="mb-2 space-y-2">
                              {item.mediaUrls.map((url) => (
                                <img
                                  key={url}
                                  src={url}
                                  alt="Message attachment"
                                  className="max-h-56 rounded-xl border border-gray-700 object-cover"
                                />
                              ))}
                            </div>
                          )}
                          {item.body && <p className="conversation-body whitespace-pre-wrap text-sm leading-6">{item.body}</p>}
                        </>
                      )}

                      <div className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-gray-400">
                        {isCall ? <span className="conversation-time">{formatTime(item.date)}</span> : <span />}
                        <div className="text-right">
                          {!isCall && (
                            <span className={`conversation-status capitalize text-[10px] font-medium ${messageStatusStyles[item.status] || 'text-gray-300'}`}>
                              {formatMessageStatus(item.status)}
                            </span>
                          )}
                          {allottedNumberLabel && <p className="conversation-allotted mt-0.5 text-[10px] text-gray-400">{allottedNumberLabel}</p>}
                          {handledByName && isCall && <p className="conversation-handler mt-0.5">{handledByName}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div ref={timelineEndRef} />
      </div>

      <form onSubmit={sendMessage} className="conversation-compose-form border-t border-gray-800 bg-[#161B28] px-5 py-4">
        {notice && <p className="conversation-notice mb-3 text-sm text-red-400">{notice}</p>}

        <div className="flex flex-col gap-3">
          <textarea
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            rows={2}
            maxLength={1600}
            placeholder="Write a message..."
            className="conversation-compose-textarea w-full resize-none rounded-xl border border-gray-700 bg-[#0F1322] px-3 py-2 text-sm text-white focus:border-emerald-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="conversation-attach-btn cursor-pointer rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-800 hover:text-white">
              {imageFile ? imageFile.name : suggestedMediaUrls.length > 0 ? `${suggestedMediaUrls.length} AI photo(s) attached` : 'Attach image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                onChange={(event) => setImageFile(event.target.files?.[0] || null)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {(imageFile || suggestedMediaUrls.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setSuggestedMediaUrls([]);
                  }}
                  className="conversation-remove-img-btn rounded-xl border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition hover:bg-gray-800 hover:text-white"
                >
                  Remove image
                </button>
              )}
              <button
                type="button"
                onClick={() => { setNotice(''); setPartSearch(''); setShowQuotePicker(true); }}
                disabled={sending || drafting}
                className="conversation-quote-btn rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60"
              >
                Send Quote
              </button>
              <button
                type="button"
                onClick={draftAiMessage}
                disabled={drafting || sending || (!phoneNumber && !leadId)}
                className="conversation-ai-draft-btn inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
              >
                {drafting ? <InlineLoader label="Drafting..." /> : <><Sparkles className="h-4 w-4" aria-hidden="true" /> AI Draft</>}
              </button>
              <button
                type="submit"
                disabled={sending}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {sending ? <InlineLoader label="Sending..." /> : 'Send SMS'}
              </button>
            </div>
          </div>
        </div>
      </form>

      {showQuotePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="quote-picker-title">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-700 bg-[#161B28] shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <div>
                <h3 id="quote-picker-title" className="text-base font-semibold text-white">Choose a service to quote</h3>
                <p className="mt-1 text-xs text-gray-400">Select an active service package to quote.</p>
              </div>
              <button type="button" onClick={() => setShowQuotePicker(false)} aria-label="Close service picker" className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-4">
              <label className="relative block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input autoFocus value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="Search services by name or category" className="w-full rounded-xl border border-gray-700 bg-[#0F1322] py-2.5 pl-10 pr-3 text-sm text-white focus:border-emerald-500" />
              </label>
              <div className="mt-3 max-h-[50vh] space-y-2 overflow-auto">
                {loadingParts ? <p className="py-8 text-center text-sm text-gray-400">Loading services...</p> : quoteParts.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">No active services found.</p> : quoteParts.map((service) => (
                  <div key={service._id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-[#0F1322] p-3 hover:border-gray-700 transition">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{service.name || service.title || 'Service'}</p>
                      <p className="mt-1 truncate text-xs text-gray-400">{service.category || 'Digital Marketing'}</p>
                      <p className="mt-1 text-sm font-semibold text-emerald-300">Starts from {service.currency || 'USD'} {Number(service.price).toFixed(2)}</p>
                    </div>
                    <button type="button" disabled={sending} onClick={() => sendServiceQuote(service)} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">Send quote</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConversationDetails;
