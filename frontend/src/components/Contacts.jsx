import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Phone, Plus, Trash2 } from 'lucide-react';
import { AppSkeletonTheme, Skeleton } from './ui/AppSkeleton.jsx';
import InlineLoader from './ui/InlineLoader.jsx';
import { confirmAction } from '../utils/confirmDialog.js';
import { showErrorToast, showSuccessToast } from '../utils/toast.js';

import { BACKEND_URL } from '../config/api.js';

function ContactsSkeleton() {
  return (
    <AppSkeletonTheme>
      <div className="space-y-2" role="status" aria-label="Loading contacts">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="bg-gray-900 border border-gray-700 rounded-2xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <Skeleton width={140} height={16} />
              <Skeleton width={116} height={12} className="mt-2 block" />
              <Skeleton width={92} height={12} className="mt-1 block" />
            </div>

            <div className="flex gap-2">
              <Skeleton width={64} height={32} borderRadius={12} />
              <Skeleton width={56} height={32} borderRadius={12} />
              <Skeleton width={66} height={32} borderRadius={12} />
            </div>
          </div>
        ))}
      </div>
    </AppSkeletonTheme>
  );
}

function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState('');
  const [newContact, setNewContact] = useState({
    name: '',
    phone: '',
    email: '',
    company: ''
  });
  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to load contacts');
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      showErrorToast('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleAddClick = async (event) => {
    event.preventDefault();

    if (!newContact.name.trim() || !newContact.phone.trim()) {
      showErrorToast('Name and phone number are required');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Save contact?',
      text: 'Do you want to save this new contact?',
      confirmButtonText: 'Save'
    });

    if (!confirmed) return;

    try {
      setSavingContact(true);
      const res = await fetch(`${BACKEND_URL}/api/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          name: newContact.name.trim(),
          phone: newContact.phone.trim(),
          email: newContact.email.trim(),
          company: newContact.company.trim()
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || 'Failed to add contact');

      showSuccessToast('Contact added successfully');
      setNewContact({ name: '', phone: '', email: '', company: '' });
      setShowAddForm(false);
      fetchContacts();
    } catch (error) {
      showErrorToast(error.message || 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  const handleCallClick = async (phone) => {
    const confirmed = await confirmAction({
      title: 'Make a call?',
      text: `Do you want to call ${phone}?`,
      confirmButtonText: 'Call Now'
    });

    if (!confirmed) return;

    window.dispatchEvent(new CustomEvent('callContact', {
      detail: { phoneNumber: phone }
    }));
    showSuccessToast(`Calling ${phone}...`);
  };

  const handleMessageClick = (phone) => {
    window.dispatchEvent(new CustomEvent('messageContact', {
      detail: { phoneNumber: phone }
    }));
  };

  const handleDeleteClick = async (id) => {
    const confirmed = await confirmAction({
      title: 'Delete contact?',
      text: 'Are you sure you want to delete this contact? This action cannot be undone.',
      confirmButtonText: 'Delete',
      icon: 'warning',
      confirmButtonColor: '#DC2626'
    });

    if (!confirmed) return;

    try {
      setDeletingContactId(id);
      const res = await fetch(`${BACKEND_URL}/api/contacts/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data.message || 'Failed to delete contact');

      showSuccessToast('Contact deleted successfully');
      fetchContacts();
    } catch (error) {
      showErrorToast(error.message || 'Failed to delete contact');
    } finally {
      setDeletingContactId('');
    }
  };

  const filteredContacts = contacts.filter((contact) => (
    String(contact.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    || String(contact.phone || '').includes(searchTerm)
  ));

  return (
    <div className="max-w-3xl mx-auto relative">
      <div className="flex justify-between items-center gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Contacts</h2>
          <p className="text-xs text-gray-400">Manage address book and quick dial contacts</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((curr) => !curr)}
          className="inline-flex items-center gap-1.5 bg-[#059669] hover:bg-[#047857] px-3.5 py-2 rounded-xl text-xs sm:text-sm text-white font-medium transition"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{showAddForm ? 'Close' : 'Add Contact'}</span>
        </button>
      </div>

      <input
        type="text"
        placeholder="Search contacts by name or phone..."
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        className="w-full bg-gray-900 border border-gray-700 text-sm text-white rounded-xl px-4 py-3 mb-4 focus:border-[#059669]"
      />

      {showAddForm && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 mb-4">
          <h3 className="text-base font-semibold mb-4 text-white">Add New Contact</h3>
          <form onSubmit={handleAddClick} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              placeholder="Full Name *"
              value={newContact.name}
              onChange={(event) => setNewContact({ ...newContact, name: event.target.value })}
              className="bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3"
              required
            />
            <input
              type="tel"
              placeholder="Phone Number *"
              value={newContact.phone}
              onChange={(event) => setNewContact({ ...newContact, phone: event.target.value })}
              className="bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3"
              required
            />
            <input
              type="email"
              placeholder="Email"
              value={newContact.email}
              onChange={(event) => setNewContact({ ...newContact, email: event.target.value })}
              className="bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3 sm:col-span-2"
            />
            <input
              type="text"
              placeholder="Company"
              value={newContact.company}
              onChange={(event) => setNewContact({ ...newContact, company: event.target.value })}
              className="bg-gray-800 border border-gray-700 text-sm text-white rounded-xl px-4 py-3 sm:col-span-2"
            />
            <button
              type="submit"
              disabled={savingContact}
              className="bg-[#059669] py-3 rounded-xl text-sm text-white font-semibold hover:bg-[#047857] disabled:opacity-70 sm:col-span-2"
            >
              {savingContact ? <InlineLoader label="Saving..." /> : 'Save Contact'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <ContactsSkeleton />
      ) : filteredContacts.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No contacts found.</p>
      ) : (
        <div className="space-y-2">
          {filteredContacts.map((contact) => (
            <div
              key={contact._id}
              className="bg-gray-900 border border-gray-700 rounded-2xl p-4 flex flex-col gap-3 hover:border-[#059669] transition sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate [html[data-theme='day']_&]:text-slate-900">{contact.name}</p>
                <p className="text-xs text-gray-400 truncate [html[data-theme='day']_&]:text-slate-500">{contact.phone}</p>
                {contact.company && <p className="crm-company-name text-xs text-gray-400 mt-0.5 truncate [html[data-theme='day']_&]:text-slate-700 font-medium">{contact.company}</p>}
              </div>

              <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center pt-2 sm:pt-0 border-t border-gray-800/60 sm:border-t-0">
                <button
                  type="button"
                  onClick={() => handleCallClick(contact.phone)}
                  className="inline-flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 px-3 py-2 rounded-xl text-xs text-white font-medium transition"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMessageClick(contact.phone)}
                  className="inline-flex items-center justify-center gap-1.5 bg-[#059669] hover:bg-[#047857] px-3 py-2 rounded-xl text-xs text-white font-medium transition"
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>SMS</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteClick(contact._id)}
                  disabled={deletingContactId === contact._id}
                  className="inline-flex items-center justify-center gap-1.5 bg-red-600/80 hover:bg-red-700 px-3 py-2 rounded-xl text-xs text-white transition disabled:opacity-70"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{deletingContactId === contact._id ? <InlineLoader label="Deleting" size="xs" /> : 'Delete'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Contacts;
