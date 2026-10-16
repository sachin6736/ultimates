import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  FileText,
  MessageSquare,
  Phone,
  ThumbsUp,
  Trash2,
  X
} from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import { confirmAction } from '../utils/confirmDialog.js';
import { showErrorToast, showSuccessToast } from '../utils/toast.js';
import useModalHistory from '../hooks/useModalHistory.js';

import { BACKEND_URL } from '../config/api.js';

const emptyForm = {
  name: '',
  phone: '',
  note: '',
  followUpDate: ''
};

const isDue = (followUp) => (
  !followUp.completed && new Date(followUp.followUpDate) <= new Date()
);

const canUsePhone = (phone) => String(phone || '').replace(/\D/g, '').length >= 7;
const getUserId = (user) => String(user?.id || user?._id || user || '');
const getFollowUpOwnerId = (followUp) => getUserId(followUp.user);
const getFollowUpOwnerLabel = (followUp) => followUp.user?.name || followUp.user?.email || 'Unassigned';

const actionIconClass = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-600 bg-gray-800 text-gray-300 transition hover:border-gray-500 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500';
const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-200 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:text-gray-500';

const readJsonResponse = async (res) => {
  const text = await res.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Follow-ups API is not available yet. Please deploy or restart the backend with the new /api/followups route.');
  }
};

function FollowUpsSkeleton() {
  return (
    <AppSkeletonTheme>
      <div role="status" aria-label="Loading follow-ups">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <Skeleton width={110} height={18} />
            <Skeleton width={150} height={12} className="mt-2 block" />
          </div>
          <Skeleton width={118} height={36} borderRadius={12} />
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <Skeleton width={92} height={16} />
          </div>
          <div className="divide-y divide-gray-800">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="px-4 py-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Skeleton width={140} height={16} />
                    <Skeleton width={112} height={12} className="mt-2 block" />
                    <Skeleton width={168} height={12} className="mt-2 block" />
                  </div>
                  <Skeleton width={54} height={24} borderRadius={999} />
                </div>
                <Skeleton width="86%" height={14} />
                <div className="mt-3 flex gap-2">
                  <Skeleton width={76} height={30} borderRadius={8} />
                  <Skeleton width={58} height={30} borderRadius={8} />
                  <Skeleton width={58} height={30} borderRadius={8} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppSkeletonTheme>
  );
}

function FollowUps({ onDueCountChange, currentUser }) {
  const [followUps, setFollowUps] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRef = useRef(null);

  const closeForm = useModalHistory(showForm, () => setShowForm(false), 'followups-form');
  const closeNoteModal = useModalHistory(Boolean(selectedNote), () => setSelectedNote(null), 'followups-note');

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
  }), []);

  const fetchFollowUps = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch(`${BACKEND_URL}/api/followups`, {
        headers: authHeaders
      });
      const data = await readJsonResponse(res);

      if (!res.ok) throw new Error(data.message || 'Failed to load follow-ups');
      setFollowUps(Array.isArray(data) ? data : []);
    } catch (error) {
      showErrorToast(error.message || 'Failed to load follow-ups');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchFollowUps();
  }, [fetchFollowUps]);

  useEffect(() => {
    const currentUserId = getUserId(currentUser);
    const dueCount = followUps.filter((followUp) => (
      isDue(followUp) && getFollowUpOwnerId(followUp) === currentUserId
    )).length;
    onDueCountChange?.(dueCount);
  }, [currentUser, followUps, onDueCountChange]);

  useEffect(() => {
    if (!openMenuId) return undefined;

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuId]);

  const sortedFollowUps = useMemo(() => [...followUps].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return new Date(a.followUpDate) - new Date(b.followUpDate);
  }), [followUps]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const createFollowUp = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.note.trim() || !form.followUpDate) {
      showErrorToast('Add a name, note, and follow-up date.');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${BACKEND_URL}/api/followups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          note: form.note.trim(),
          followUpDate: new Date(form.followUpDate).toISOString()
        })
      });

      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.message || 'Failed to create follow-up');

      setForm(emptyForm);
      closeForm();
      showSuccessToast('Follow-up saved');
      window.dispatchEvent(new Event('refreshFollowUps'));
      fetchFollowUps({ silent: true });
    } catch (error) {
      showErrorToast(error.message || 'Failed to create follow-up');
    } finally {
      setSaving(false);
    }
  };

  const updateCompleted = async (followUp, completed) => {
    if (completed && !followUp.note?.trim()) {
      showErrorToast('A follow-up note is required before completing');
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/followups/${followUp._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ completed })
      });

      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.message || 'Failed to update follow-up');

      setFollowUps((current) => current.map((item) => (
        item._id === followUp._id ? data.followUp : item
      )));
      showSuccessToast('Follow-up completed');
      window.dispatchEvent(new Event('refreshFollowUps'));
      window.dispatchEvent(new Event('refreshLeads'));
    } catch (error) {
      showErrorToast(error.message || 'Failed to update follow-up');
    }
  };

  const deleteFollowUp = async (followUp) => {
    const confirmed = await confirmAction({
      title: 'Delete follow-up?',
      text: 'This follow-up will be removed permanently.',
      confirmButtonText: 'Delete',
      icon: 'warning',
      confirmButtonColor: '#DC2626'
    });

    if (!confirmed) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/followups/${followUp._id}`, {
        method: 'DELETE',
        headers: authHeaders
      });
      const data = await readJsonResponse(res);

      if (!res.ok) throw new Error(data.message || 'Failed to delete follow-up');

      setFollowUps((current) => current.filter((item) => item._id !== followUp._id));
      showSuccessToast('Follow-up deleted');
      window.dispatchEvent(new Event('refreshFollowUps'));
      window.dispatchEvent(new Event('refreshLeads'));
    } catch (error) {
      showErrorToast(error.message || 'Failed to delete follow-up');
    }
  };

  const handleCall = (phoneNumber) => {
    if (!canUsePhone(phoneNumber)) return;

    window.dispatchEvent(new CustomEvent('callContact', {
      detail: { phoneNumber }
    }));
  };

  const handleMessage = (phoneNumber) => {
    if (!canUsePhone(phoneNumber)) return;

    window.dispatchEvent(new CustomEvent('messageContact', {
      detail: { phoneNumber }
    }));
    window.dispatchEvent(new CustomEvent('openConversation', {
      detail: { phoneNumber }
    }));
  };

  const formatDate = (date) => new Date(date).toLocaleString([], {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <FollowUpsSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Follow Ups</h2>
          <p className="mt-0.5 text-xs text-gray-400">Track reminders and pending callbacks.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showForm) {
              closeForm();
            } else {
              setShowForm(true);
            }
          }}
          className="rounded-xl bg-[#059669] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#047857]"
        >
          {showForm ? 'Close' : 'Save Follow-up'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createFollowUp} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-4 text-base font-semibold text-white">New Follow-up</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs text-gray-400">Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
                placeholder="Customer name"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-gray-400">Phone</label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
                placeholder="+1..."
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs text-gray-400">Date and Time</label>
              <input
                type="datetime-local"
                name="followUpDate"
                value={form.followUpDate}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs text-gray-400">Note</label>
              <textarea
                name="note"
                value={form.note}
                onChange={handleChange}
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
                placeholder="What should be followed up?"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-[#059669] py-3 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
          >
            {saving ? <InlineLoader label="Saving..." /> : 'Save Follow-up'}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Follow-ups</h3>
        </div>

        {sortedFollowUps.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">No follow-ups yet.</p>
        ) : (
          <div className="divide-y divide-gray-800">
            {sortedFollowUps.map((followUp) => {
              const due = isDue(followUp);
              const isMenuOpen = openMenuId === followUp._id;

              return (
                <div key={followUp._id} className="group relative px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className={`truncate text-sm font-semibold ${followUp.completed ? 'text-gray-500 line-through' : 'text-white'}`}>
                        {followUp.name}
                      </p>
                      {followUp.phone && <span className="text-xs font-medium text-gray-400">{followUp.phone}</span>}
                      {followUp.user && <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-400">{getFollowUpOwnerLabel(followUp)}</span>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedNote(followUp)}
                        className={actionIconClass}
                        title="View note"
                        aria-label="View note"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {followUp.phone && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCall(followUp.phone)}
                            disabled={!canUsePhone(followUp.phone)}
                            className={actionIconClass}
                            title={`Call ${followUp.phone}`}
                            aria-label={`Call ${followUp.phone}`}
                          >
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMessage(followUp.phone)}
                            disabled={!canUsePhone(followUp.phone)}
                            className={actionIconClass}
                            title={`Message ${followUp.phone}`}
                            aria-label={`Message ${followUp.phone}`}
                          >
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between gap-2 pr-8">
                    <div className="min-w-0 flex-1 text-xs">
                      <span className={`font-medium ${due ? 'text-red-300' : followUp.completed ? 'text-gray-500' : 'text-gray-300'}`}>
                        {formatDate(followUp.followUpDate)}
                      </span>
                    </div>
                  </div>

                  <div
                    ref={isMenuOpen ? menuRef : null}
                    className={`absolute bottom-2 right-2.5 z-20 ${isMenuOpen ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100'}`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenMenuId((current) => (current === followUp._id ? null : followUp._id))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-700/60 bg-gray-800/80 text-gray-300 transition hover:bg-gray-700 hover:text-white"
                      title="More actions"
                      aria-label="More actions"
                      aria-expanded={isMenuOpen}
                      aria-haspopup="menu"
                    >
                      <ChevronDown className={`h-4 w-4 transition ${isMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>

                    {isMenuOpen && (
                      <div
                        role="menu"
                        className="absolute bottom-full right-0 mb-1 w-36 overflow-hidden rounded-lg border border-gray-700 bg-gray-950 py-1 shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (followUp.completed) return;
                            updateCompleted(followUp, true);
                            setOpenMenuId(null);
                          }}
                          disabled={followUp.completed}
                          className={menuItemClass}
                        >
                          <ThumbsUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Completed
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenMenuId(null);
                            deleteFollowUp(followUp);
                          }}
                          className={`${menuItemClass} text-red-300 hover:text-red-200`}
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedNote && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-lg border border-gray-800 bg-[#0B1220] p-3 shadow-2xl ring-1 ring-white/5">
            <button
              type="button"
              onClick={closeNoteModal}
              className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-600"
              title="Close note"
              aria-label="Close note"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="rounded-md border border-gray-800 bg-gray-900/70 px-3 py-2.5">
              <p className="max-h-72 overflow-y-auto whitespace-pre-wrap pr-7 text-sm leading-5 text-gray-100">
                {selectedNote.note}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FollowUps;
