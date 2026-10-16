import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from './LoadingSpinner.jsx';


import { BACKEND_URL } from '../config/api.js';

const emptyForm = { 
  name: '',
  email: '',
  password: '',
  role: 'agent'
};

const getDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const getMonthInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
};

const getDateRangeParams = (selectedMonthValue, selectedDateValue) => {
  const now = new Date();
  const [monthYear, monthNumber] = (selectedMonthValue || getMonthInputValue()).split('-').map(Number);
  const monthStart = new Date(monthYear || now.getFullYear(), (monthNumber || now.getMonth() + 1) - 1, 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const selectedDate = selectedDateValue
    ? new Date(`${selectedDateValue}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateEnd = new Date(selectedDate);
  dateEnd.setDate(dateEnd.getDate() + 1);

  return new URLSearchParams({
    monthStart: monthStart.toISOString(),
    monthEnd: monthEnd.toISOString(),
    dateStart: selectedDate.toISOString(),
    dateEnd: dateEnd.toISOString()
  });
};

const formatDateTime = (value) => {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

function StatCard({ label, value, tone }) {
  const tones = {
    total: 'border-emerald-500/20 bg-[#059669]/10 text-emerald-300',
    inbound: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    outbound: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    missed: 'border-red-500/20 bg-red-500/10 text-red-300',
    messages: 'border-violet-500/20 bg-violet-500/10 text-violet-300'
  };

  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function AdminDashboard({ showStats = true, showCreateUser = true, showUsers = true }) {
  const [activityStats, setActivityStats] = useState({
    month: { calls: 0, messages: 0 },
    selectedDate: { calls: 0, messages: 0 }
  });
  const [statsMonthInput, setStatsMonthInput] = useState(() => getMonthInputValue());
  const [statsDateInput, setStatsDateInput] = useState(() => getDateInputValue());
  const [appliedStatsMonth, setAppliedStatsMonth] = useState(() => getMonthInputValue());
  const [appliedStatsDate, setAppliedStatsDate] = useState(() => getDateInputValue());
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [users, setUsers] = useState([]);
  const [ownedNumbers, setOwnedNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [syncingNumbers, setSyncingNumbers] = useState(false);
  const [assigningNumber, setAssigningNumber] = useState('');
  const [settingDefaultNumber, setSettingDefaultNumber] = useState('');
  const [notice, setNotice] = useState({ text: '', type: '' });

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
  }), []);

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const statsParams = getDateRangeParams(appliedStatsMonth, appliedStatsDate);
      statsParams.set('refreshKey', String(statsRefreshKey));

      const statsPromise = showStats
        ? fetch(`${BACKEND_URL}/api/auth/admin-activity-stats?${statsParams}`, {
            headers: authHeaders
          })
        : Promise.resolve(null);
      const usersPromise = showUsers
        ? fetch(`${BACKEND_URL}/api/auth/users`, { headers: authHeaders })
        : Promise.resolve(null);
      const numbersPromise = showUsers
        ? fetch(`${BACKEND_URL}/api/phone-numbers`, { headers: authHeaders })
        : Promise.resolve(null);

      const [statsRes, usersRes, numbersRes] = await Promise.all([
        statsPromise,
        usersPromise,
        numbersPromise
      ]);

      const [statsData, usersData, numbersData] = await Promise.all([
        statsRes ? statsRes.json() : Promise.resolve(null),
        usersRes ? usersRes.json() : Promise.resolve(null),
        numbersRes ? numbersRes.json() : Promise.resolve(null)
      ]);

      if (statsRes && !statsRes.ok) throw new Error(statsData.message || 'Failed to load activity totals');
      if (usersRes && !usersRes.ok) throw new Error(usersData.message || 'Failed to load users');
      if (numbersRes && !numbersRes.ok) throw new Error(numbersData.message || 'Failed to load phone numbers');

      if (showStats) {
        setActivityStats({
          month: {
            calls: Number(statsData?.month?.calls) || 0,
            messages: Number(statsData?.month?.messages) || 0
          },
          selectedDate: {
            calls: Number(statsData?.selectedDate?.calls) || 0,
            messages: Number(statsData?.selectedDate?.messages) || 0
          }
        });
      }
      if (showUsers) {
        setUsers(Array.isArray(usersData) ? usersData : []);
        setOwnedNumbers(Array.isArray(numbersData) ? numbersData : []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [appliedStatsDate, appliedStatsMonth, authHeaders, showStats, showUsers, statsRefreshKey]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    const refreshStats = () => {
      if (showStats) {
        setStatsRefreshKey((current) => current + 1);
      }
    };

    window.addEventListener('refreshCallHistory', refreshStats);
    window.addEventListener('refreshMessages', refreshStats);

    return () => {
      window.removeEventListener('refreshCallHistory', refreshStats);
      window.removeEventListener('refreshMessages', refreshStats);
    };
  }, [showStats]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const refreshActivityStats = () => {
    setAppliedStatsMonth(statsMonthInput);
    setAppliedStatsDate(statsDateInput);
    setStatsRefreshKey((current) => current + 1);
  };

  const createUser = async (event) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      setNotice({ text: 'Enter name, email, and a password with at least 6 characters.', type: 'error' });
      return;
    }

    try {
      setCreating(true);
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create user');

      setForm(emptyForm);
      setNotice({ text: `${data.user?.name || 'User'} created successfully.`, type: 'success' });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const importNumbers = async () => {
    try {
      setSyncingNumbers(true);
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/phone-numbers/import`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to import Twilio numbers');

      setOwnedNumbers(Array.isArray(data) ? data : []);
      setNotice({
        text: `Synced ${Array.isArray(data) ? data.length : 0} purchased Twilio number${Array.isArray(data) && data.length === 1 ? '' : 's'}.`,
        type: 'success'
      });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    } finally {
      setSyncingNumbers(false);
    }
  };

  const getAssignedUserIds = (number) => {
    if (Array.isArray(number.assignedUsers) && number.assignedUsers.length > 0) {
      return number.assignedUsers.map((user) => user?._id || user?.id || user).filter(Boolean);
    }

    const legacyUserId = number.assignedTo?._id || number.assignedTo?.id || number.assignedTo || '';
    return legacyUserId ? [legacyUserId] : [];
  };

  const assignNumber = async (numberId, userIds) => {
    try {
      setAssigningNumber(numberId);
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/phone-numbers/${numberId}/assign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ userIds })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to assign phone number');

      const assignedCount = Array.isArray(userIds) ? userIds.length : 0;
      setNotice({
        text: assignedCount > 0
          ? `${data.phoneNumber} assigned to ${assignedCount} user${assignedCount === 1 ? '' : 's'}.`
          : `${data.phoneNumber} unassigned.`,
        type: 'success'
      });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    } finally {
      setAssigningNumber('');
    }
  };

  const toggleNumberAssignment = (number, userId) => {
    const numberId = number.id || number._id;
    const currentUserIds = getAssignedUserIds(number).map((id) => String(id));
    const nextUserIds = currentUserIds.includes(String(userId))
      ? currentUserIds.filter((id) => id !== String(userId))
      : [...currentUserIds, String(userId)];

    assignNumber(numberId, nextUserIds);
  };

  const toggleLeadAssignmentStatus = async (userId, currentValue) => {
    try {
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/auth/users/${userId}/assignment-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ active: !currentValue })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to update assignment status');

      setNotice({
        text: `Lead assignment ${data.user?.isLeadAssignmentActive ? 'enabled' : 'disabled'} for ${data.user?.name || 'user'}.`,
        type: 'success'
      });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    }
  };

  const toggleAiReplyStatus = async (userId, currentValue) => {
    try {
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/auth/users/${userId}/ai-reply-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ active: !currentValue })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to update AI reply status');

      setNotice({
        text: `AI Auto-reply ${data.user?.isAiAutoReplyActive ? 'enabled' : 'disabled'} for ${data.user?.name || 'user'}.`,
        type: 'success'
      });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    }
  };

  const setDefaultNumber = async (numberId, userId) => {
    try {
      setSettingDefaultNumber(numberId);
      setNotice({ text: '', type: '' });

      const res = await fetch(`${BACKEND_URL}/api/phone-numbers/${numberId}/default`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to set default phone number');

      const selectedUser = users.find((user) => String(user._id || user.id) === String(userId));
      setNotice({
        text: `${data.phoneNumber} is now the default sender for ${selectedUser?.name || 'the selected user'}.`,
        type: 'success'
      });
      fetchDashboardData();
    } catch (err) {
      setNotice({ text: err.message, type: 'error' });
    } finally {
      setSettingDefaultNumber('');
    }
  };

  const getUserAssignedNumbers = (userId) => ownedNumbers.filter((number) => (
    getAssignedUserIds(number).some((assignedId) => String(assignedId) === String(userId))
  ));

  if (loading) return <LoadingSpinner label="Loading admin dashboard..." />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {notice.text && (
        <div className={`rounded-xl px-4 py-3 text-sm text-white ${
          notice.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {notice.text}
        </div>
      )}

      {showStats && (
        <>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Monthly Activity</h3>
                <p className="text-xs text-gray-400">Choose a month and date, then refresh the counts.</p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[auto_auto_auto] sm:items-end">
                <div>
                  <label className="mb-1.5 block text-xs text-gray-400">Filter by month</label>
                  <input
                    type="month"
                    value={statsMonthInput}
                    onChange={(event) => setStatsMonthInput(event.target.value)}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-[#059669] sm:w-auto"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-gray-400">Filter by date</label>
                  <input
                    type="date"
                    value={statsDateInput}
                    onChange={(event) => setStatsDateInput(event.target.value)}
                    className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-[#059669] sm:w-auto"
                  />
                </div>
                <button
                  type="button"
                  onClick={refreshActivityStats}
                  className="w-full rounded-xl bg-[#059669] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#047857] sm:w-auto"
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Selected Month Calls" value={activityStats.month.calls} tone="total" />
              <StatCard label="Selected Month Messages" value={activityStats.month.messages} tone="messages" />
              <StatCard label="Selected Date Calls" value={activityStats.selectedDate.calls} tone="outbound" />
              <StatCard label="Selected Date Messages" value={activityStats.selectedDate.messages} tone="messages" />
            </div>
          </div>

        </>
      )}

      {showCreateUser && (
        <form onSubmit={createUser} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">Create User</h3>
          <p className="text-xs text-gray-400">Add a user or admin account.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
              placeholder="Username"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
              placeholder="email@company.com"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Role</label>
            <select
              name="role"
              value={form.role}
              onChange={handleChange}
              className="w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white focus:border-[#059669]"
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="mt-4 w-full rounded-xl bg-[#059669] py-3 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
        >
          {creating ? <LoadingSpinner label="Creating..." size="sm" tone="white" inline /> : 'Create User'}
        </button>
        </form>
      )}

      {showUsers && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">Twilio Numbers</h3>
              <p className="text-xs text-gray-400">Sync purchased Twilio numbers, assign the same number to multiple users, and choose each user's default sender.</p>
            </div>
            <button
              type="button"
              onClick={importNumbers}
              disabled={syncingNumbers}
              className="shrink-0 rounded-lg bg-[#059669] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
            >
              {syncingNumbers ? 'Syncing...' : 'Sync Twilio'}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-800">
            <div className="border-b border-gray-800 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Purchased Twilio Numbers</h4>
            </div>
            {ownedNumbers.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">Click Sync Twilio to import purchased numbers.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {ownedNumbers.map((number) => {
                  const numberId = number.id || number._id;
                  const assignedUserIds = getAssignedUserIds(number).map((id) => String(id));

                  return (
                    <div key={numberId || number.sid} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_1.4fr] md:items-start">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{number.phoneNumber}</p>
                        <p className="truncate text-xs text-gray-400">{number.friendlyName || number.sid}</p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {assignedUserIds.length > 0
                            ? `${assignedUserIds.length} user${assignedUserIds.length === 1 ? '' : 's'} assigned`
                            : 'No users assigned'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {users.map((user) => {
                            const userId = String(user._id || user.id);
                            const isAssigned = assignedUserIds.includes(userId);
                            const isDefault = isAssigned && (
                              user.assignedPhoneNumberSid === number.sid
                              || user.assignedPhoneNumber === number.phoneNumber
                            );

                            return (
                              <label
                                key={userId}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                                  isAssigned
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                                    : 'border-gray-700 bg-gray-800 text-gray-300'
                                } ${assigningNumber === numberId ? 'opacity-60' : 'cursor-pointer hover:border-emerald-500/60'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isAssigned}
                                  disabled={assigningNumber === numberId}
                                  onChange={() => toggleNumberAssignment(number, userId)}
                                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 text-[#059669] focus:ring-[#059669]"
                                />
                                <span>{user.name}</span>
                                {isDefault && <span className="text-[10px] uppercase tracking-wide text-emerald-300">default</span>}
                              </label>
                            );
                          })}
                        </div>
                        {assignedUserIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            {assignedUserIds.map((userId) => {
                              const assignedUser = users.find((user) => String(user._id || user.id) === userId);
                              const isDefault = assignedUser?.assignedPhoneNumberSid === number.sid
                                || assignedUser?.assignedPhoneNumber === number.phoneNumber;

                              return (
                                <button
                                  key={`${numberId}-${userId}`}
                                  type="button"
                                  onClick={() => setDefaultNumber(numberId, userId)}
                                  disabled={isDefault || settingDefaultNumber === numberId || assigningNumber === numberId}
                                  className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-60 ${
                                    isDefault
                                      ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                      : 'border border-gray-700 bg-gray-800 text-gray-200 hover:border-emerald-500/60 hover:text-white'
                                  }`}
                                >
                                  {isDefault
                                    ? `${assignedUser?.name || 'User'} default`
                                    : settingDefaultNumber === numberId
                                      ? 'Saving...'
                                      : `Set default for ${assignedUser?.name || 'user'}`}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showUsers && (
        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
          <div className="border-b border-gray-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Created Users</h3>
          </div>

          {users.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No users created yet.</p>
          ) : (
            <div className="divide-y divide-gray-800">
              {users.map((user) => {
                const userId = user._id || user.id;
                const assignedNumbers = getUserAssignedNumbers(userId);

                return (
                  <div key={userId} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                      <p className="truncate text-xs text-gray-400">{user.email}</p>
                      <div className="mt-2 grid gap-1 text-[11px] text-gray-400 sm:grid-cols-2">
                        <p className="break-words">
                          <span className="text-gray-500">Login IP:</span> {user.lastLoginIp || 'Not recorded'}
                        </p>
                        <p className="break-words">
                          <span className="text-gray-500">Logout IP:</span> {user.lastLogoutIp || 'Not recorded'}
                        </p>
                        <p className="break-words">
                          <span className="text-gray-500">Last login:</span> {formatDateTime(user.lastLoginAt)}
                        </p>
                        <p className="break-words">
                          <span className="text-gray-500">Last logout:</span> {formatDateTime(user.lastLogoutAt)}
                        </p>
                      </div>
                      {assignedNumbers.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {assignedNumbers.map((number) => {
                            const isDefault = user.assignedPhoneNumberSid === number.sid
                              || user.assignedPhoneNumber === number.phoneNumber;

                            return (
                              <span
                                key={number.id || number._id || number.sid}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                                  isDefault
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                    : 'border-gray-700 text-gray-300'
                                }`}
                              >
                                {number.phoneNumber}{isDefault ? ' default' : ''}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-gray-500">No numbers assigned</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-800/60 pt-2.5 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                      <div className="flex flex-wrap gap-1.5 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => toggleAiReplyStatus(userId, user.isAiAutoReplyActive !== false)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                            user.isAiAutoReplyActive !== false
                              ? 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
                              : 'border border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                          title="Toggle automatic AI replies for this user's assigned leads"
                        >
                          {user.isAiAutoReplyActive !== false ? 'AI Agent on' : 'AI Agent off'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleLeadAssignmentStatus(userId, user.isLeadAssignmentActive !== false)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                            user.isLeadAssignmentActive !== false
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : 'border border-gray-700 bg-gray-800 text-gray-300'
                          }`}
                        >
                          {user.isLeadAssignmentActive !== false ? 'Assignment on' : 'Assignment off'}
                        </button>
                      </div>
                      <span className="rounded-full border border-gray-700 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-gray-300">
                        {user.role}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
