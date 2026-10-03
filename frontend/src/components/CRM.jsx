import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, History, MessageSquare, PencilLine, Phone, Sparkles } from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import LeadCallLogsDrawer from './LeadCallLogsDrawer.jsx';
import { showErrorToast, showSuccessToast } from '../utils/toast.js';
import { formatPhoneNumber } from '../utils/phone.js';
import { BACKEND_URL } from '../config/api.js';

export const SERVICE_OPTIONS = [
  'Google Ads / PPC',
  'Meta Ads',
  'SEO',
  'Social Media Marketing',
  'Website Design & Development',
  'Landing Page',
  'Lead Generation',
  'Content Marketing',
  'Email Marketing',
  'CRM Automation',
  'WhatsApp Automation',
  'AI Social Media Automation',
  'Software / Custom Development',
  'Full Digital Marketing Package',
  'Other',
];

export const LEAD_DISPOSITIONS = [
  'New Lead',
  'Contact Attempted',
  'Contacted',
  'Qualified',
  'Proposal Sent',
  'Negotiation',
  'Payment Pending',
  'Won – Client',
  'Lost',
  'Follow Up Later',
];

export const LOST_REASONS = [
  'Price too high',
  'Went with competitor',
  'Not interested',
  'No response',
  'Budget unavailable',
  'Delayed project',
  'Service not required',
  'Bad / fake lead',
  'Other',
];

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  companyName: '',
  serviceInterestedIn: 'Google Ads / PPC',
  industry: '',
  businessType: '',
  websiteUrl: '',
  disposition: 'New Lead',
  lostReason: '',
  lostReasonDetails: '',
  notes: '',
  source: 'manual',
  followUpAt: '',
  followUpNote: '',
};

const emptyFilters = {
  status: '',
  assignee: '',
  source: '',
  fromDate: '',
  toDate: '',
  search: '',
};

function CRMPageSkeleton() {
  return (
    <AppSkeletonTheme>
      <div className="space-y-4" role="status" aria-label="Loading leads">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
          <Skeleton width={120} height={16} />
          <Skeleton width="70%" height={12} className="mt-2 block" />
        </div>
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} height={40} className="mt-2 block" />
          ))}
        </div>
      </div>
    </AppSkeletonTheme>
  );
}

const formatDate = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleDateString();
};

const formatShortDate = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
};

const formatSourceTooltip = (source) => {
  const labels = {
    manual: 'manually created',
    website: 'website',
    facebook: 'facebook',
    other: 'other',
  };

  return labels[source] || source || 'manual';
};

const canUsePhone = (phone) => String(phone || '').replace(/\D/g, '').length >= 7;

const parseLeadNotes = (notes = '') => {
  return String(notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(.+?) - ([^:]+):\s*(.*)$/);
      if (!match) {
        return {
          id: `${index}-${line}`,
          dateTime: '',
          user: 'Note',
          text: line,
        };
      }

      const [, dateTime, user, text] = match;
      return {
        id: `${index}-${dateTime}-${user}`,
        dateTime,
        user,
        text,
      };
    });
};

function NoteTimeline({ notes }) {
  const entries = parseLeadNotes(notes);

  if (!entries.length) {
    return <p className="rounded-xl border border-dashed border-gray-800 bg-gray-900 p-3 text-sm text-gray-500">No notes yet.</p>;
  }

  return (
    <div className="max-h-64 overflow-auto rounded-xl border border-gray-800 bg-gray-900 thin-scrollbar">
      {entries.map((entry) => (
        <div key={entry.id} className="grid gap-3 border-b border-gray-800 p-3 last:border-b-0 sm:grid-cols-[150px_1fr]">
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-gray-300">{entry.user}</p>
            {entry.dateTime && <p className="leading-relaxed text-gray-500">{entry.dateTime}</p>}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.text}</p>
        </div>
      ))}
    </div>
  );
}

function CRM() {
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [updatingLeadId, setUpdatingLeadId] = useState(null);
  const [noteLeadId, setNoteLeadId] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [followUpLeadId, setFollowUpLeadId] = useState(null);
  const [followUpDrafts, setFollowUpDrafts] = useState({});
  const [submittingNoteId, setSubmittingNoteId] = useState(null);
  const [submittingFollowUpId, setSubmittingFollowUpId] = useState(null);
  const [callLogsLeadId, setCallLogsLeadId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [paginationMeta, setPaginationMeta] = useState({ page: 1, limit: 3, totalCount: 0, totalPages: 1 });
  const [lostReasonModal, setLostReasonModal] = useState(null);
  const [savingLostReason, setSavingLostReason] = useState(false);

  const [updatingAiStatus, setUpdatingAiStatus] = useState(false);

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }), []);

  const toggleMyAiReply = async () => {
    try {
      setUpdatingAiStatus(true);
      const nextStatus = !(currentUser?.isAiAutoReplyActive !== false);
      const res = await fetch(`${BACKEND_URL}/api/auth/me/ai-reply-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ active: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update AI auto-reply status');

      setCurrentUser((current) => ({
        ...current,
        isAiAutoReplyActive: data.user?.isAiAutoReplyActive,
      }));
      showSuccessToast(data.message || `AI Auto-Reply ${nextStatus ? 'ON' : 'OFF'}`);
    } catch (error) {
      showErrorToast(error.message || 'Failed to update AI auto-reply status');
    } finally {
      setUpdatingAiStatus(false);
    }
  };

  const fetchLeads = useCallback(async (filtersToApply = appliedFilters, pageToUse = currentPage) => {
    try {
      const params = new URLSearchParams();
      if (filtersToApply.status) params.set('status', filtersToApply.status);
      if (filtersToApply.assignee) params.set('assignee', filtersToApply.assignee);
      if (filtersToApply.source) params.set('source', filtersToApply.source);
      if (filtersToApply.fromDate) params.set('fromDate', filtersToApply.fromDate);
      if (filtersToApply.toDate) params.set('toDate', filtersToApply.toDate);
      if (filtersToApply.search) params.set('search', filtersToApply.search);
      params.set('page', String(pageToUse));
      params.set('limit', '3');

      const res = await fetch(`${BACKEND_URL}/api/leads${params.toString() ? `?${params.toString()}` : ''}`, {
        headers: authHeaders,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to load leads');
      const payload = data && typeof data === 'object' && Array.isArray(data.leads) ? data : { leads: Array.isArray(data) ? data : [], page: 1, limit: 3, totalCount: Array.isArray(data) ? data.length : 0, totalPages: 1 };
      setLeads(payload.leads || []);
      setPaginationMeta({
        page: Number(payload.page) || 1,
        limit: Number(payload.limit) || 3,
        totalCount: Number(payload.totalCount) || 0,
        totalPages: Number(payload.totalPages) || 1,
      });
      setCurrentPage(Number(payload.page) || 1);
    } catch (error) {
      showErrorToast(error.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, authHeaders, currentPage]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/users`, {
        headers: authHeaders,
      });
      const data = await res.json();

      if (res.ok) {
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load users', error);
    }
  }, [authHeaders]);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentUser(data);
      }
    } catch (error) {
      console.error('Failed to load current user', error);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchLeads(appliedFilters, currentPage);
    fetchUsers();
    fetchCurrentUser();
  }, [appliedFilters, currentPage, fetchCurrentUser, fetchLeads, fetchUsers]);

  useEffect(() => {
    const handleRefreshLeads = () => {
      fetchLeads(appliedFilters, currentPage);
    };

    window.addEventListener('refreshLeads', handleRefreshLeads);
    return () => window.removeEventListener('refreshLeads', handleRefreshLeads);
  }, [appliedFilters, fetchLeads]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleApplyFilters = (event) => {
    event.preventDefault();
    setCurrentPage(1);
    setAppliedFilters(filters);
  };

  const handleResetFilters = () => {
    setFilters(emptyFilters);
    setCurrentPage(1);
    setAppliedFilters(emptyFilters);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      showErrorToast('Contact Name, Email, and Phone / WhatsApp are required');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${BACKEND_URL}/api/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create lead');

      setForm(emptyForm);
      setShowCreateForm(false);
      setCurrentPage(1);
      showSuccessToast(currentUser?.role === 'admin' ? 'Lead created and assigned to the next active agent' : 'Lead created successfully');
      fetchLeads(appliedFilters, 1);
    } catch (error) {
      showErrorToast(error.message || 'Failed to create lead');
    } finally {
      setSaving(false);
    }
  };

  const updateLeadDisposition = async (leadId, disposition, lostReason = '', lostReasonDetails = '') => {
    try {
      setUpdatingLeadId(leadId);
      const res = await fetch(`${BACKEND_URL}/api/leads/${leadId}/disposition`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ disposition, lostReason, lostReasonDetails }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to update lead status');

      setLeads((current) => current.map((lead) => (
        lead._id === leadId ? data.lead : lead
      )));
      showSuccessToast(
        disposition === 'Lost'
          ? `Lead marked as Lost (${data.lead?.lostReason || lostReason || 'Reason recorded'})`
          : 'Lead status updated'
      );
    } catch (error) {
      showErrorToast(error.message || 'Failed to update lead status');
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const handleStatusChange = (lead, nextDisposition) => {
    if (nextDisposition === 'Lost') {
      setLostReasonModal({
        leadId: lead._id,
        name: lead.name,
        companyName: lead.companyName,
        lostReason: lead.lostReason || 'Price too high',
        lostReasonDetails: lead.lostReasonDetails || '',
        previousDisposition: lead.disposition || 'New Lead',
      });
    } else {
      updateLeadDisposition(lead._id, nextDisposition);
    }
  };

  const handleConfirmLostReason = async () => {
    if (!lostReasonModal) return;
    try {
      setSavingLostReason(true);
      await updateLeadDisposition(
        lostReasonModal.leadId,
        'Lost',
        lostReasonModal.lostReason || 'Price too high',
        lostReasonModal.lostReasonDetails || ''
      );
      setLostReasonModal(null);
    } finally {
      setSavingLostReason(false);
    }
  };

  const addLeadNote = async (leadId) => {
    const note = (noteDrafts[leadId] || '').trim();
    if (!note) {
      showErrorToast('Please enter a note before saving');
      return;
    }

    try {
      setSubmittingNoteId(leadId);
      const res = await fetch(`${BACKEND_URL}/api/leads/${leadId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to save note');

      setLeads((current) => current.map((lead) => (
        lead._id === leadId ? data.lead : lead
      )));
      setNoteDrafts((current) => ({ ...current, [leadId]: '' }));
      setNoteLeadId(null);
      showSuccessToast('Note added');
    } catch (error) {
      showErrorToast(error.message || 'Failed to save note');
    } finally {
      setSubmittingNoteId(null);
    }
  };

  const saveFollowUp = async (leadId) => {
    const draft = followUpDrafts[leadId] || {};
    if (!draft.followUpAt) {
      showErrorToast('Please choose a reminder date');
      return;
    }

    if (!draft.followUpNote?.trim()) {
      showErrorToast('Please enter a follow-up note');
      return;
    }

    try {
      setSubmittingFollowUpId(leadId);
      const res = await fetch(`${BACKEND_URL}/api/leads/${leadId}/follow-up`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          followUpAt: draft.followUpAt,
          followUpNote: draft.followUpNote || '',
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to save follow-up');

      setLeads((current) => current.map((lead) => (
        lead._id === leadId ? data.lead : lead
      )));
      setFollowUpDrafts((current) => ({ ...current, [leadId]: {} }));
      setFollowUpLeadId(null);
      window.dispatchEvent(new Event('refreshFollowUps'));
      showSuccessToast('Follow-up scheduled');
    } catch (error) {
      showErrorToast(error.message || 'Failed to save follow-up');
    } finally {
      setSubmittingFollowUpId(null);
    }
  };

  const handleCallLead = (phoneNumber) => {
    if (!canUsePhone(phoneNumber)) return;

    window.dispatchEvent(new CustomEvent('callContact', {
      detail: { phoneNumber },
    }));
  };

  const handleMessageLead = (lead) => {
    const phoneNumber = lead?.phone;
    if (!canUsePhone(phoneNumber)) return;

    window.dispatchEvent(new CustomEvent('messageContact', {
      detail: { phoneNumber, leadId: lead._id },
    }));
    window.dispatchEvent(new CustomEvent('openConversation', {
      detail: { phoneNumber, leadId: lead._id },
    }));
  };

  const selectedNoteLead = useMemo(
    () => leads.find((lead) => lead._id === noteLeadId),
    [leads, noteLeadId]
  );

  const selectedCallLogsLead = useMemo(
    () => leads.find((lead) => lead._id === callLogsLeadId),
    [callLogsLeadId, leads]
  );

  return (
    <div className="crm-page mx-auto flex h-full max-w-6xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">CRM Leads</h2>
          <p className="text-sm text-gray-400">Review leads, assign follow-ups, and keep notes in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleMyAiReply}
            disabled={updatingAiStatus}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
              currentUser?.isAiAutoReplyActive !== false
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            } disabled:opacity-60`}
            title={currentUser?.isAiAutoReplyActive !== false ? 'Click to turn AI Agent replies OFF' : 'Click to turn AI Agent replies ON'}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>AI Auto-Reply: {currentUser?.isAiAutoReplyActive !== false ? 'ON' : 'OFF'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((current) => !current)}
            className="inline-flex items-center justify-center rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#047857]"
          >
            {showCreateForm ? 'Close Form' : 'Create Lead'}
          </button>
        </div>
      </div>

      {showCreateForm && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
          <div className="mb-4 border-b border-gray-800 pb-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-white">
              <span className="text-emerald-400">Ultimate Ads Solution</span>
              <span className="text-sm font-normal text-gray-500">· New Lead</span>
            </h3>
            <p className="mt-1 text-xs text-gray-400">Add a new client lead for marketing campaigns and automated follow-ups.</p>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Contact Name <span className="text-emerald-400">*</span>
              </label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Contact Name *"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Email <span className="text-emerald-400">*</span>
              </label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="Email *"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Phone / WhatsApp <span className="text-emerald-400">*</span>
              </label>
              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="Phone / WhatsApp *"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Company Name
              </label>
              <input
                name="companyName"
                value={form.companyName || ''}
                onChange={handleChange}
                placeholder="Company Name"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Service Interested In
              </label>
              <select
                name="serviceInterestedIn"
                value={form.serviceInterestedIn || 'Google Ads / PPC'}
                onChange={(e) => {
                  handleChange(e);
                  setForm((prev) => ({ ...prev, serviceInterestedIn: e.target.value }));
                }}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {SERVICE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Industry / Business Type
              </label>
              <input
                name="industry"
                value={form.industry || ''}
                onChange={(e) => {
                  handleChange(e);
                  setForm((prev) => ({ ...prev, industry: e.target.value, businessType: e.target.value }));
                }}
                placeholder="Industry / Business Type"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Website URL
              </label>
              <input
                name="websiteUrl"
                value={form.websiteUrl || ''}
                onChange={handleChange}
                placeholder="Website URL (e.g. https://example.com)"
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Lead Status
              </label>
              <select
                name="disposition"
                value={form.disposition || 'New Lead'}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {LEAD_DISPOSITIONS.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            {form.disposition === 'Lost' && (
              <div className="md:col-span-2 rounded-xl border border-rose-800/40 bg-rose-950/20 p-3.5 space-y-2">
                <label className="block text-xs font-semibold text-rose-300">
                  Lost Reason <span className="text-rose-400">*</span>
                </label>
                <select
                  name="lostReason"
                  value={form.lostReason || 'Price too high'}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-rose-700/60 bg-gray-900 px-3 py-2.5 text-sm text-white focus:border-rose-500 focus:outline-none"
                >
                  {LOST_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
                <input
                  name="lostReasonDetails"
                  value={form.lostReasonDetails || ''}
                  onChange={handleChange}
                  placeholder="Additional details on why lead was lost (optional)"
                  className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none"
                />
              </div>
            )}

            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Notes / Requirements
              </label>
              <textarea
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="Notes / Requirements..."
                className="min-h-24 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-300">
                Follow-up Note (Optional)
              </label>
              <textarea
                name="followUpNote"
                value={form.followUpNote}
                onChange={handleChange}
                placeholder="Optional follow-up reminder note"
                className="min-h-16 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-70 md:col-span-2"
            >
              {saving ? <InlineLoader label="Saving Lead" /> : 'Save Lead'}
            </button>
          </form>
          <p className="mt-2 text-xs text-gray-500">
            {currentUser?.role === 'admin' ? 'Admin-created leads are assigned to the next active agent in a round-robin rotation.' : 'Your leads stay assigned to you.'}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
        <form onSubmit={handleApplyFilters} className={`grid gap-3 md:grid-cols-3 ${currentUser?.role === 'admin' ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
          <input
            type="text"
            name="search"
            value={filters.search}
            onChange={handleFilterChange}
            placeholder="Search contact, company, email, phone, service..."
            className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
          />
          <select name="status" value={filters.status} onChange={handleFilterChange} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none">
            <option value="">All statuses</option>
            {LEAD_DISPOSITIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          {currentUser?.role === 'admin' && (
            <select name="assignee" value={filters.assignee} onChange={handleFilterChange} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none">
              <option value="">All assignees</option>
              {users.map((user) => <option key={user._id || user.id} value={user._id || user.id}>{user.name}</option>)}
            </select>
          )}
          <select name="source" value={filters.source} onChange={handleFilterChange} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none">
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="website">Website</option>
            <option value="facebook">Facebook</option>
            <option value="other">Other</option>
          </select>
          <input type="date" name="fromDate" value={filters.fromDate} onChange={handleFilterChange} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
          <input type="date" name="toDate" value={filters.toDate} onChange={handleFilterChange} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
          <div className={`flex gap-2 md:col-span-3 ${currentUser?.role === 'admin' ? 'xl:col-span-6' : 'xl:col-span-5'}`}>
            <button type="submit" className="rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#047857]">Apply Filters</button>
            <button type="button" onClick={handleResetFilters} className="rounded-xl border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white">Reset</button>
          </div>
        </form>
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-gray-800 bg-gray-900 p-4">
        {loading ? (
          <CRMPageSkeleton />
        ) : leads.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No leads found.</p>
        ) : (
          <div className="space-y-3">
            {leads.map((lead) => {
              const isFollowUpDue = lead.followUpAt && new Date(lead.followUpAt) <= new Date();
              const isFollowUpSoon = lead.followUpAt && new Date(lead.followUpAt) <= new Date(Date.now() + 24 * 60 * 60 * 1000);
              const hasUsablePhone = canUsePhone(lead.phone);

              return (
                <div key={lead._id} className="rounded-2xl border border-gray-800 bg-gray-950 p-3.5 transition hover:border-gray-700 hover:bg-gray-900/60">
                  <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-base font-semibold text-white">{lead.name || 'Unnamed lead'}</h4>
                        {lead.companyName && (
                          <span className="rounded-md border border-gray-700 bg-gray-800/80 px-2 py-0.5 text-xs text-gray-300">
                            {lead.companyName}
                          </span>
                        )}
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          lead.disposition === 'Lost'
                            ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                        }`}>
                          {lead.disposition || 'New Lead'}
                          {lead.disposition === 'Lost' && lead.lostReason ? ` · ${lead.lostReason}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (noteLeadId === lead._id) {
                              setNoteLeadId(null);
                              return;
                            }
                            setNoteLeadId(lead._id);
                            setFollowUpLeadId(null);
                          }}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition
                            ${noteLeadId === lead._id
                              ? 'border-gray-400 bg-gray-700 text-white'
                              : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-white'}`}
                          title={noteLeadId === lead._id ? 'Close notes / requirements' : 'Open notes / requirements'}
                          aria-label={noteLeadId === lead._id ? 'Close notes / requirements' : 'Open notes / requirements'}
                        >
                          <PencilLine className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (followUpLeadId === lead._id) {
                              setFollowUpLeadId(null);
                              return;
                            }
                            setFollowUpLeadId(lead._id);
                            setNoteLeadId(null);
                            setFollowUpDrafts((current) => ({
                              ...current,
                              [lead._id]: {
                                followUpAt: lead.followUpAt ? new Date(lead.followUpAt).toISOString().slice(0, 16) : '',
                                followUpNote: lead.followUpNote || '',
                              },
                            }));
                          }}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition
                            ${isFollowUpDue
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                              : followUpLeadId === lead._id
                                ? 'border-gray-400 bg-gray-700 text-white'
                                : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-white'}`}
                          title={followUpLeadId === lead._id ? 'Hide reminder editor' : 'Schedule follow-up'}
                          aria-label={followUpLeadId === lead._id ? 'Hide reminder editor' : 'Schedule follow-up'}
                        >
                          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCallLogsLeadId(lead._id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-900 text-gray-300 transition hover:border-gray-600 hover:bg-gray-800 hover:text-white"
                          title="View call logs"
                          aria-label={`View call logs for ${lead.name || 'lead'}`}
                        >
                          <History className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {isFollowUpDue && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">Follow-up due</span>}
                        {isFollowUpSoon && !isFollowUpDue && <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300">Reminder soon</span>}
                      </div>

                      <div className="mt-3 space-y-1.5 text-sm">
                        <div className="grid gap-x-8 gap-y-1.5 text-gray-300 md:grid-cols-3">
                          <p className="min-w-0">
                            <span className="text-gray-500">Phone / WhatsApp:</span>{' '}
                            <span className="font-medium text-gray-200">{formatPhoneNumber(lead.phone) || lead.phone || '-'}</span>
                          </p>
                          <p className="min-w-0">
                            <span className="text-gray-500">Email:</span>{' '}
                            <span className="break-all font-medium text-gray-200">{lead.email || '-'}</span>
                          </p>
                          <p className="min-w-0">
                            <span className="text-gray-500">Company:</span>{' '}
                            <span className="font-medium text-gray-200">{lead.companyName || '-'}</span>
                          </p>
                        </div>
                        <div className="grid gap-x-8 gap-y-1.5 text-gray-300 md:grid-cols-3">
                          <p className="min-w-0">
                            <span className="text-gray-500">Service:</span>{' '}
                            <span className="font-semibold text-emerald-400">{lead.serviceInterestedIn || '-'}</span>
                          </p>
                          <p className="min-w-0">
                            <span className="text-gray-500">Industry / Type:</span>{' '}
                            <span className="font-medium text-gray-200">{lead.industry || lead.businessType || '-'}</span>
                          </p>
                          <p className="min-w-0">
                            <span className="text-gray-500">Website:</span>{' '}
                            {lead.websiteUrl ? (
                              <a
                                href={lead.websiteUrl.startsWith('http') ? lead.websiteUrl : `https://${lead.websiteUrl}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="font-medium text-emerald-400 underline hover:text-emerald-300 truncate inline-block max-w-[200px] align-bottom"
                              >
                                {lead.websiteUrl}
                              </a>
                            ) : (
                              <span className="font-medium text-gray-200">-</span>
                            )}
                          </p>
                        </div>
                        <p
                          className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-gray-300"
                          title={`Lead generated: ${formatDate(lead.createdAt)} Source: ${formatSourceTooltip(lead.source)}`}
                          aria-label={`Lead generated: ${formatDate(lead.createdAt)} Source: ${formatSourceTooltip(lead.source)}`}
                        >
                          <span>
                            <span className="text-gray-500">Assignee:</span>{' '}
                            <span className="font-medium text-gray-200">{lead.assignedTo?.name|| lead.assignedTo?.email || 'Unassigned'}</span>
                          </span>
                          <span className="text-gray-600">|</span>
                          <span className="font-medium text-gray-200">{formatShortDate(lead.createdAt)}</span>
                          <span className="text-gray-600">|</span>
                          <span className="capitalize font-medium text-gray-200">{lead.source || 'manual'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 lg:w-52">
                      <select
                        aria-label={`Status for ${lead.name || 'lead'}`}
                        value={lead.disposition || 'New Lead'}
                        disabled={updatingLeadId === lead._id}
                        onChange={(event) => handleStatusChange(lead, event.target.value)}
                        className={`h-8 rounded-lg border px-2.5 text-xs font-semibold outline-none disabled:cursor-wait disabled:opacity-60 ${
                          lead.disposition === 'Lost'
                            ? 'border-rose-600/40 bg-rose-600/10 text-rose-300'
                            : 'border-emerald-600/30 bg-emerald-600/10 text-emerald-300'
                        }`}
                      >
                        {LEAD_DISPOSITIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>

                      {lead.disposition === 'Lost' && (
                        <div className="flex items-center justify-between gap-1 rounded-lg border border-rose-900/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-300">
                          <span className="truncate" title={`Lost Reason: ${lead.lostReason || 'Not specified'}${lead.lostReasonDetails ? ` (${lead.lostReasonDetails})` : ''}`}>
                            Lost: <span className="font-semibold text-rose-200">{lead.lostReason || 'Not specified'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setLostReasonModal({
                              leadId: lead._id,
                              name: lead.name,
                              companyName: lead.companyName,
                              lostReason: lead.lostReason || 'Price too high',
                              lostReasonDetails: lead.lostReasonDetails || '',
                              previousDisposition: lead.disposition,
                            })}
                            className="shrink-0 text-[10px] font-medium text-rose-400 hover:text-white underline ml-1"
                            title="Update lost reason"
                          >
                            Edit
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCallLead(lead.phone)}
                        disabled={!hasUsablePhone}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                        title={hasUsablePhone ? `Call ${lead.phone}` : 'No phone number'}
                        aria-label={hasUsablePhone ? `Call ${lead.phone}` : 'No phone number to call'}
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        Make Call
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMessageLead(lead)}
                        disabled={!hasUsablePhone}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 text-xs font-medium text-sky-200 transition hover:border-sky-400 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500"
                        title={hasUsablePhone ? `Open SMS for ${lead.phone}` : 'No phone number'}
                        aria-label={hasUsablePhone ? `Open SMS for ${lead.phone}` : 'No phone number to message'}
                      >
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        Open SMS
                      </button>
                    </div>
                  </div>

                  {followUpLeadId === lead._id && (
                    <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Follow-up reminder</label>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          type="datetime-local"
                          value={followUpDrafts[lead._id]?.followUpAt || ''}
                          onChange={(event) => setFollowUpDrafts((current) => ({
                            ...current,
                            [lead._id]: {
                              ...(current[lead._id] || {}),
                              followUpAt: event.target.value,
                            },
                          }))}
                          className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
                        />
                        <textarea
                          value={followUpDrafts[lead._id]?.followUpNote || ''}
                          onChange={(event) => setFollowUpDrafts((current) => ({
                            ...current,
                            [lead._id]: {
                              ...(current[lead._id] || {}),
                              followUpNote: event.target.value,
                            },
                          }))}
                          placeholder="Reminder note"
                          className="min-h-20 rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => saveFollowUp(lead._id)}
                          disabled={submittingFollowUpId === lead._id}
                          className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-70"
                        >
                          {submittingFollowUpId === lead._id ? <InlineLoader label="Saving" /> : 'Save reminder'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFollowUpLeadId(null);
                            setFollowUpDrafts((current) => ({ ...current, [lead._id]: {} }));
                          }}
                          className="rounded-xl border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && leads.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 border-t border-gray-800 pt-4 text-sm text-gray-400 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {Math.min((paginationMeta.page - 1) * paginationMeta.limit + leads.length, paginationMeta.totalCount)} of {paginationMeta.totalCount} leads
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
                className="rounded-xl border border-gray-700 px-3 py-2 font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-gray-300">
                Page {paginationMeta.page} / {paginationMeta.totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((value) => Math.min(paginationMeta.totalPages, value + 1))}
                disabled={currentPage >= paginationMeta.totalPages}
                className="rounded-xl border border-gray-700 px-3 py-2 font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedNoteLead && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-800 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white">Notes / Requirements</h3>
                <p className="truncate text-sm text-gray-400">
                  {selectedNoteLead.name || 'Unnamed lead'}
                  {selectedNoteLead.companyName ? ` (${selectedNoteLead.companyName})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNoteLeadId(null)}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-400 transition hover:bg-gray-800 hover:text-white"
                title="Close"
                aria-label="Close notes"
              >
                X
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">History / Current notes</p>
                <NoteTimeline notes={selectedNoteLead.notes} />
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Add note / requirement</label>
                <textarea
                  value={noteDrafts[selectedNoteLead._id] || ''}
                  onChange={(event) => setNoteDrafts((current) => ({ ...current, [selectedNoteLead._id]: event.target.value }))}
                  placeholder="Add notes, client requirements, or next steps..."
                  className="min-h-28 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setNoteLeadId(null);
                  setNoteDrafts((current) => ({ ...current, [selectedNoteLead._id]: '' }));
                }}
                className="rounded-xl border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition hover:border-gray-600 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => addLeadNote(selectedNoteLead._id)}
                disabled={submittingNoteId === selectedNoteLead._id}
                className="rounded-xl bg-[#059669] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-70"
              >
                {submittingNoteId === selectedNoteLead._id ? <InlineLoader label="Saving" /> : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lostReasonModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-900/60 bg-gray-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-800 pb-3">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <span className="text-rose-400">Lost Reason</span>
                </h3>
                <p className="mt-1 text-xs text-gray-400">
                  Select why <strong className="text-gray-200">{lostReasonModal.name || 'this lead'}</strong> was marked as lost:
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLostReasonModal(null)}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-400 transition hover:bg-gray-800 hover:text-white"
                title="Cancel"
                aria-label="Close lost reason modal"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Lost Reason <span className="text-rose-400">*</span>
                </label>
                <select
                  value={lostReasonModal.lostReason || 'Price too high'}
                  onChange={(e) => setLostReasonModal((prev) => ({ ...prev, lostReason: e.target.value }))}
                  className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white focus:border-rose-500 focus:outline-none"
                >
                  {LOST_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Additional Details (Optional)
                </label>
                <textarea
                  value={lostReasonModal.lostReasonDetails || ''}
                  onChange={(e) => setLostReasonModal((prev) => ({ ...prev, lostReasonDetails: e.target.value }))}
                  placeholder="Notes, competitor details, or customer feedback..."
                  className="min-h-20 w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-gray-800 pt-3">
              <button
                type="button"
                onClick={() => setLostReasonModal(null)}
                className="rounded-xl border border-gray-700 px-3.5 py-2 text-sm font-semibold text-gray-300 hover:border-gray-600 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLostReason}
                disabled={savingLostReason}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-70"
              >
                {savingLostReason ? <InlineLoader label="Saving" /> : 'Save Lost Reason'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LeadCallLogsDrawer
        lead={selectedCallLogsLead}
        isOpen={Boolean(selectedCallLogsLead)}
        onClose={() => setCallLogsLeadId(null)}
      />
    </div>
  );
}

export default CRM;

