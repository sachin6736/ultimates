import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, MessageSquare, Phone, X } from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import { buildPagedUrl, PAGE_SIZE, parsePagedResponse } from '../utils/pagination.js';
import { showCopiedNumberToast, showErrorToast } from '../utils/toast.js';
import { BACKEND_URL } from '../config/api.js';

const callStyles = {
  outbound: {
    label: 'Outbound',
    iconClass: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    statusClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
  },
  inbound: {
    label: 'Inbound',
    iconClass: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
    statusClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
  },
  missed: {
    label: 'Missed',
    iconClass: 'bg-red-500/10 text-red-300 ring-red-500/20',
    statusClass: 'bg-red-500/10 text-red-300 border-red-500/20'
  },
  default: {
    label: 'Call',
    iconClass: 'bg-gray-500/10 text-gray-300 ring-gray-500/20',
    statusClass: 'bg-gray-500/10 text-gray-300 border-gray-500/20'
  }
};

function LeadCallLogsSkeleton() {
  return (
    <AppSkeletonTheme>
      <div className="space-y-3" role="status" aria-label="Loading lead call logs">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
            <Skeleton width="40%" height={16} />
            <Skeleton width="70%" height={12} className="mt-2 block" />
            <Skeleton width="60%" height={12} className="mt-2 block" />
          </div>
        ))}
      </div>
    </AppSkeletonTheme>
  );
}

const formatPhoneNumber = (phone) => {
  if (!phone) return 'Unknown';

  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.length === 10) {
    return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  return phone;
};

const canCallNumber = (phone) => String(phone || '').replace(/\D/g, '').length >= 7;

const getCallDate = (log) => log.startedAt || log.createdAt;

const formatDateTime = (date) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '-';

  return `${value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })} at ${value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
};

const getCallMeta = (log) => {
  const status = log.status?.toLowerCase();
  const callType = log.callType?.toLowerCase();
  const visualType = ['missed', 'rejected', 'failed', 'answered-by-teammate'].includes(status)
    ? status
    : callType || 'default';
  const style = callStyles[visualType] || callStyles.default;
  return {
    ...style,
    visualType,
    directionLabel: callStyles[callType]?.label || callStyles.default.label,
    statusLabel: (status || 'unknown').replace(/-/g, ' ')
  };
};

const getCallTime = (log) => {
  const time = new Date(getCallDate(log)).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const PhoneIcon = () => <Phone className="h-4 w-4" aria-hidden="true" />;
const MessageIcon = () => <MessageSquare className="h-4 w-4" aria-hidden="true" />;
const CopyIcon = () => <Copy className="h-4 w-4" aria-hidden="true" />;
const CloseIcon = () => <X className="h-4 w-4" aria-hidden="true" />;
function LeadCallLogsDrawer({ lead, isOpen, onClose }) {
  const [logs, setLogs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState('');

  const phoneNumber = lead?.phone || '';

  const fetchCallLogs = useCallback(async ({ reset = false, before = null } = {}) => {
    if (!phoneNumber) return;

    try {
      if (reset) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const res = await fetch(buildPagedUrl(`${BACKEND_URL}/api/calls/logs`, {
        limit: PAGE_SIZE,
        before,
        extraParams: { phoneNumber }
      }), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!res.ok) throw new Error('Failed to load lead call logs');

      const page = parsePagedResponse(await res.json());
      setLogs((current) => (reset ? page.items : [...current, ...page.items]));
      setHasMore(page.hasMore);
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (reset) setError(err.message);
    } finally {
      if (reset) setLoading(false);
      setLoadingMore(false);
    }
  }, [phoneNumber]);

  useEffect(() => {
    if (!isOpen || !phoneNumber) return;
    fetchCallLogs({ reset: true });
  }, [fetchCallLogs, isOpen, phoneNumber]);

  useEffect(() => {
    if (!isOpen || !phoneNumber) return undefined;
    const handler = () => fetchCallLogs({ reset: true });
    window.addEventListener('refreshCallHistory', handler);
    return () => window.removeEventListener('refreshCallHistory', handler);
  }, [fetchCallLogs, isOpen, phoneNumber]);

  const loadMoreLogs = () => {
    if (!hasMore || loading || loadingMore || !nextBefore) return;
    fetchCallLogs({ before: nextBefore });
  };

  const handleCopyNumber = async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showCopiedNumberToast({ phoneNumber: formatPhoneNumber(value) });
    } catch (err) {
      console.error('Failed to copy phone number:', err);
      showErrorToast('Failed to copy phone number');
    }
  };

    const handleMakeCall = (value) => {
    if (!canCallNumber(value)) return;
    onClose();
    window.dispatchEvent(new CustomEvent('callContact', { detail: { phoneNumber: value } }));
  };

  const handleMessage = (value) => {
    if (!canCallNumber(value)) return;
    window.dispatchEvent(new CustomEvent('messageContact', { detail: { phoneNumber: value } }));
    window.dispatchEvent(new CustomEvent('openConversation', { detail: { phoneNumber: value } }));
  };

  const visibleLogs = useMemo(() => [...logs].sort((a, b) => getCallTime(b) - getCallTime(a)), [logs]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-black/60">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-gray-800 bg-[#0F1322] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-4 py-4">
          <div className="min-w-0">
            <h3 className="crm-lead-name truncate text-lg font-semibold text-white [html[data-theme='day']_&]:text-slate-900">{lead?.name || 'Lead'}</h3>
            <p className="mt-1 text-sm text-gray-400">{formatPhoneNumber(phoneNumber)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-700 text-gray-300 transition hover:bg-gray-800 hover:text-white"
            aria-label="Close lead call logs"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-auto thin-scrollbar p-4">
          {loading ? (
            <LeadCallLogsSkeleton />
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : visibleLogs.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">No calls found for this lead.</p>
          ) : (
            <div className="space-y-3">
              {visibleLogs.map((log) => {
                const meta = getCallMeta(log);
                const logId = log._id || log.callSid;
                const transcriptText = String(log.transcriptionText || '').trim();
                const showTranscript = expandedTranscriptId === logId;

                return (
                  <div key={logId} className="rounded-xl border border-gray-800 bg-gray-950 p-3">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${meta.iconClass}`}>
                        <PhoneIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-white">{formatPhoneNumber(log.phoneNumber)}</p>
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">{meta.directionLabel}</span>
                          <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] font-medium text-gray-300">{meta.statusLabel}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{formatDateTime(getCallDate(log))} {log.duration ? `| ${Math.floor(Number(log.duration) / 60)}m ${Number(log.duration) % 60}s` : ''}</p>
                      </div>

                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMakeCall(log.phoneNumber)}
                          disabled={!canCallNumber(log.phoneNumber)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                          title={`Call ${formatPhoneNumber(log.phoneNumber)}`}
                          aria-label={`Call ${formatPhoneNumber(log.phoneNumber)}`}
                        >
                          <PhoneIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMessage(log.phoneNumber)}
                          disabled={!canCallNumber(log.phoneNumber)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                          title={`Message ${formatPhoneNumber(log.phoneNumber)}`}
                          aria-label={`Message ${formatPhoneNumber(log.phoneNumber)}`}
                        >
                          <MessageIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyNumber(log.phoneNumber)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-900 text-gray-300 transition hover:border-gray-600 hover:text-white"
                          title={`Copy ${formatPhoneNumber(log.phoneNumber)}`}
                          aria-label={`Copy ${formatPhoneNumber(log.phoneNumber)}`}
                        >
                          <CopyIcon />
                        </button>
                      </div>
                    </div>

                    {(transcriptText || log.transcriptionStatus !== 'not-started') && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setExpandedTranscriptId(showTranscript ? '' : logId)}
                          className="inline-flex items-center rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:bg-gray-800 hover:text-white"
                        >
                          {transcriptText ? 'Transcript' : `Transcript ${log.transcriptionStatus}`}
                        </button>
                        {showTranscript && (
                          <div className="mt-2 rounded-lg border border-gray-800 bg-[#0F141F] p-3 text-sm leading-6 text-gray-300">
                            {transcriptText || 'Transcript is not available yet.'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && hasMore && (
            <div className="py-4 text-center">
              <button
                type="button"
                onClick={loadMoreLogs}
                disabled={loadingMore}
                className="rounded-xl border border-gray-700 bg-[#0F141F] px-4 py-2 text-xs font-semibold text-gray-200 transition hover:border-gray-600 hover:bg-[#1F2533] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore ? <LoadingSpinner label="Loading..." size="sm" tone="white" inline /> : 'Load more calls'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LeadCallLogsDrawer;
