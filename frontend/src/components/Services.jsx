import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Check,
  CheckCircle2,
  DollarSign,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

import InlineLoader from './ui/InlineLoader.jsx';
import { confirmAction } from '../utils/confirmDialog.js';
import { showErrorToast, showSuccessToast } from '../utils/toast.js';
import { BACKEND_URL } from '../config/api.js';

export const STANDARD_SERVICES = [
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

const emptyForm = {
  selectedOption: 'Google Ads / PPC',
  customName: '',
  category: 'Digital Marketing',
  price: '',
  currency: 'USD',
  description: '',
  deliverables: '',
  status: 'active',
};

const formatPrice = (value, currency = 'USD') => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

function Services({ currentUser = null }) {
  const isAdmin = currentUser?.role === 'admin';

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchServices = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        search: search.trim(),
        status: statusFilter,
        sort: sortBy,
        limit: '100',
      });

      const res = await fetch(`${BACKEND_URL}/api/services?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to fetch services');
      }

      setServices(Array.isArray(data.services) ? data.services : []);
    } catch (err) {
      console.error('fetchServices error:', err);
      showErrorToast(err.message || 'Error loading services');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, sortBy]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const summary = useMemo(() => {
    const total = services.length;
    const active = services.filter((s) => s.status === 'active').length;
    const prices = services.map((s) => Number(s.price)).filter((p) => Number.isFinite(p) && p > 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;

    return { total, active, minPrice, maxPrice };
  }, [services]);

  const handleOpenAddModal = () => {
    setEditingService(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (service) => {
    setEditingService(service);
    const isStandard = STANDARD_SERVICES.includes(service.name);

    setForm({
      selectedOption: isStandard ? service.name : 'Other',
      customName: isStandard ? '' : service.name,
      category: service.category || 'Digital Marketing',
      price: service.price ?? '',
      currency: service.currency || 'USD',
      description: service.description || '',
      deliverables: Array.isArray(service.deliverables) ? service.deliverables.join(', ') : '',
      status: service.status || 'active',
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (submitting) return;
    setIsModalOpen(false);
    setEditingService(null);
    setForm(emptyForm);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const serviceName = form.selectedOption === 'Other'
      ? form.customName.trim()
      : form.selectedOption;

    if (!serviceName) {
      showErrorToast('Please provide a service name');
      return;
    }

    const priceNum = Number(form.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      showErrorToast('Please enter a valid starting price (>= 0)');
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');

      const deliverablesArray = form.deliverables
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const payload = {
        name: serviceName,
        category: form.category.trim() || 'Digital Marketing',
        price: priceNum,
        currency: form.currency || 'USD',
        description: form.description.trim(),
        deliverables: deliverablesArray,
        status: form.status,
      };

      const url = editingService
        ? `${BACKEND_URL}/api/services/${editingService._id}`
        : `${BACKEND_URL}/api/services`;

      const method = editingService ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Operation failed');
      }

      showSuccessToast(editingService ? 'Service updated successfully' : 'Service created successfully');
      handleCloseModal();
      fetchServices();
    } catch (err) {
      console.error('handleSubmit error:', err);
      showErrorToast(err.message || 'Failed to save service');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (service) => {
    const confirmed = await confirmAction({
      title: 'Delete Service?',
      text: `Are you sure you want to remove "${service.name}"? This action cannot be undone.`,
      confirmButtonText: 'Delete Service',
      confirmButtonColor: '#DC2626',
      icon: 'warning',
    });

    if (!confirmed) return;

    try {
      setDeletingId(service._id);
      const token = localStorage.getItem('token');

      const res = await fetch(`${BACKEND_URL}/api/services/${service._id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to delete service');
      }

      showSuccessToast('Service deleted successfully');
      fetchServices();
    } catch (err) {
      console.error('handleDelete error:', err);
      showErrorToast(err.message || 'Failed to delete service');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#0A0C14] p-4 text-white thin-scrollbar md:p-6">
      {/* Header & Title */}
      <div className="flex flex-col gap-4 border-b border-gray-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
              <Briefcase className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">
                Services & Solutions
              </h1>
              <p className="text-xs text-gray-400 md:text-sm">
                Offered agency services, starting packages & deliverables
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchServices(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Add Service button: VISIBLE ONLY TO ADMIN */}
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span>Add Service</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
        <div className="rounded-2xl border border-gray-800/90 bg-[#11151F] p-3.5 shadow-md">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium">Total Services</span>
            <Layers className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white md:text-2xl">{summary.total}</p>
          <span className="text-[11px] text-gray-400">All catalog items</span>
        </div>

        <div className="rounded-2xl border border-gray-800/90 bg-[#11151F] p-3.5 shadow-md">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium">Active Services</span>
            <CheckCircle2 className="h-4 w-4 text-teal-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-emerald-400 md:text-2xl">{summary.active}</p>
          <span className="text-[11px] text-gray-400">Available to quote</span>
        </div>

        <div className="rounded-2xl border border-gray-800/90 bg-[#11151F] p-3.5 shadow-md">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium">Starting From</span>
            <DollarSign className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-xl font-bold text-white md:text-2xl">
            {formatPrice(summary.minPrice)}
          </p>
          <span className="text-[11px] text-gray-400">Entry package</span>
        </div>

        <div className="rounded-2xl border border-gray-800/90 bg-[#11151F] p-3.5 shadow-md">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium">Admin Controlled</span>
            <Sparkles className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 text-sm font-semibold text-white md:text-base">
            {isAdmin ? 'Full Admin Access' : 'Agent (View Only)'}
          </p>
          <span className="text-[11px] text-gray-400">
            {isAdmin ? 'Add, edit & delete active' : 'Quoting enabled'}
          </span>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-gray-800 bg-[#11151F] p-3.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by service name, description, category..."
            className="w-full rounded-xl border border-gray-700 bg-gray-900/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="newest">Newest First</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="name_asc">Name: A to Z</option>
            <option value="name_desc">Name: Z to A</option>
          </select>
        </div>
      </div>

      {/* Services Grid */}
      <div className="mt-5 flex-1">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin text-emerald-400" />
            <p className="text-sm">Loading services catalog...</p>
          </div>
        ) : services.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-[#11151F]/50 p-6 text-center">
            <Briefcase className="h-10 w-10 text-gray-600" />
            <p className="mt-3 text-base font-semibold text-white">No services found</p>
            <p className="mt-1 text-xs text-gray-400">
              {search ? 'Try clearing your search query or filters.' : 'Add your first service package to get started.'}
            </p>
            {isAdmin && (
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                + Add Service
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((service) => {
              const isActive = service.status === 'active';
              const isDeleting = deletingId === service._id;

              return (
                <div
                  key={service._id}
                  className="group relative flex flex-col justify-between rounded-2xl border border-gray-800 bg-[#11151F] p-5 shadow-xl transition-all duration-200 hover:border-gray-700 hover:shadow-2xl hover:shadow-emerald-500/5"
                >
                  <div>
                    {/* Top Row: Category + Status Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-gray-800/80 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                        {service.category || 'Digital Marketing'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                            : 'bg-gray-800 text-gray-400'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isActive ? 'bg-emerald-400' : 'bg-gray-400'
                          }`}
                        />
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {/* Service Name */}
                    <h3 className="mt-3 text-base font-bold text-white transition group-hover:text-emerald-300">
                      {service.name}
                    </h3>

                    {/* Price Starting From */}
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="text-xs font-medium text-gray-400">Starts from</span>
                      <span className="font-mono text-xl font-extrabold text-emerald-400">
                        {formatPrice(service.price, service.currency)}
                      </span>
                    </div>

                    {/* Description */}
                    {service.description && (
                      <p className="mt-2.5 text-xs leading-relaxed text-gray-400">
                        {service.description}
                      </p>
                    )}

                    {/* Deliverables tags */}
                    {Array.isArray(service.deliverables) && service.deliverables.length > 0 && (
                      <div className="mt-3.5 flex flex-wrap gap-1.5">
                        {service.deliverables.map((item, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-md bg-[#161B28] px-2 py-0.5 text-[10px] font-medium text-gray-300 border border-gray-800"
                          >
                            <Check className="h-2.5 w-2.5 text-emerald-400" />
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Admin Actions (Only for Admin) */}
                  {isAdmin && (
                    <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-800/80 pt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(service)}
                        className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
                        title="Edit Service"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(service)}
                        disabled={isDeleting}
                        className="flex items-center gap-1 rounded-lg border border-red-950/40 bg-red-950/20 px-2.5 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-950/50 hover:text-red-300 disabled:opacity-50"
                        title="Delete Service"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Admin Add / Edit Service Modal */}
      {isModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#161B28] shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  {editingService ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </div>
                <h3 className="text-base font-semibold text-white">
                  {editingService ? 'Edit Service' : 'Add New Service'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={submitting}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5">
              <div className="flex flex-col gap-4">
                {/* Service Selection */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-300">
                    Service Interested In <span className="text-red-400">*</span>
                  </label>
                  <select
                    name="selectedOption"
                    value={form.selectedOption}
                    onChange={handleFormChange}
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    required
                  >
                    {STANDARD_SERVICES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Custom Name if "Other" */}
                {form.selectedOption === 'Other' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-300">
                      Custom Service Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      name="customName"
                      value={form.customName}
                      onChange={handleFormChange}
                      placeholder="e.g. Influencer Marketing, Video Production"
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                      required
                    />
                  </div>
                )}

                {/* Pricing & Category Row */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-300">
                      Prices Starts From ($ USD) <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-gray-400">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        name="price"
                        value={form.price}
                        onChange={handleFormChange}
                        placeholder="e.g. 499"
                        className="w-full rounded-xl border border-gray-700 bg-gray-900 py-2.5 pl-8 pr-3.5 text-sm text-white focus:border-emerald-500 focus:outline-none font-mono"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-300">Category</label>
                    <input
                      type="text"
                      name="category"
                      value={form.category}
                      onChange={handleFormChange}
                      placeholder="e.g. Paid Advertising"
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-300">
                    Package Description / Scope
                  </label>
                  <textarea
                    rows={2}
                    name="description"
                    value={form.description}
                    onChange={handleFormChange}
                    placeholder="Briefly describe what this service provides..."
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Deliverables */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-300">
                    Key Deliverables <span className="text-gray-500">(comma separated)</span>
                  </label>
                  <input
                    type="text"
                    name="deliverables"
                    value={form.deliverables}
                    onChange={handleFormChange}
                    placeholder="e.g. Audit, Keyword Research, Ad Copy, Conversion Tracking"
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-300">Status</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        value="active"
                        checked={form.status === 'active'}
                        onChange={handleFormChange}
                        className="text-emerald-500 focus:ring-emerald-500"
                      />
                      <span>Active</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="status"
                        value="inactive"
                        checked={form.status === 'inactive'}
                        onChange={handleFormChange}
                        className="text-emerald-500 focus:ring-emerald-500"
                      />
                      <span>Inactive</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-800 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={submitting}
                  className="rounded-xl border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {submitting ? (
                    <InlineLoader label={editingService ? 'Updating...' : 'Saving...'} />
                  ) : (
                    <span>{editingService ? 'Update Service' : 'Save Service'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Services;
