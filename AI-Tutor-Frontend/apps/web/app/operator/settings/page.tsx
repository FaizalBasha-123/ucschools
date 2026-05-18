'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Shield, Server, Key, Info, Loader2, Plus, Trash2, Mail, Check, AlertCircle } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { operatorSignOut, getOperatorToken, clearOperatorSession } from '@/lib/auth/session';
import { createLogger } from '@/lib/logger';

const log = createLogger('OperatorSettings');

interface OperatorSettings {
  operator_roles: string;
  api_base_url: string;
}

export default function OperatorSettingsPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<OperatorSettings | null>(null);

  // Email management
  const [emails, setEmails] = useState<string[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/operator/settings', { cache: 'no-store' });
        if (res.status === 401) { clearOperatorSession(); router.push('/operator/login'); return; }
        if (!res.ok) throw new Error('Failed to fetch settings');
        const data = await res.json();
        if (data.success && data.operator_roles !== undefined) {
          setSettings(data);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        log.error('Failed to fetch settings', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [router]);

  // Fetch operator emails
  const fetchEmails = async () => {
    setEmailsLoading(true);
    try {
      const res = await fetch('/api/operator/settings/emails', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch emails');
      const data = await res.json();
      if (data.success && data.emails) {
        setEmails(data.emails);
      }
    } catch (err) {
      log.error('Failed to fetch operator emails', err);
    } finally {
      setEmailsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !error) {
      fetchEmails();
    }
  }, [loading, error]);

  const handleAddEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setAddError('Enter a valid email address');
      return;
    }
    setAddingEmail(true);
    setAddError(null);
    setAddSuccess(null);
    try {
      const res = await fetch('/api/operator/settings/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add email');
      }
      setAddSuccess(`${email} added successfully`);
      setNewEmail('');
      fetchEmails();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add email');
    } finally {
      setAddingEmail(false);
    }
  };

  const handleRemoveEmail = async (email: string) => {
    setRemovingEmail(email);
    try {
      const res = await fetch(`/api/operator/settings/emails/${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to remove email');
      fetchEmails();
    } catch (err) {
      log.error('Failed to remove email', err);
    } finally {
      setRemovingEmail(null);
    }
  };

  return (
    <DashboardShell
      variant="operator"
      onSignOut={async () => {
        await operatorSignOut();
        router.push('/operator/login');
      }}
      shellClassName="bg-neutral-50 dark:bg-neutral-900/50"
    >
      <div className="flex-1 overflow-y-auto p-8 pt-12">
        <div className="max-w-4xl mx-auto">
          
          <div className="mb-10">
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Settings className="size-8 text-primary" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Platform configuration and operator mappings.</p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p>Loading configuration...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-6 flex items-start gap-4 mb-8">
              <Info className="size-6 text-red-600 dark:text-red-400 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900 dark:text-red-300">Failed to Load Settings</h3>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              </div>
            </div>
          ) : settings ? (
            <div className="space-y-8">
              
              {/* Operator Access Control - Email Management */}
              <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Mail className="size-5 text-primary" /> Operator Emails
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Manage which email addresses can receive OTP codes for operator access. Changes take effect immediately.
                  </p>
                </div>
                <div className="p-6">
                  {/* Add email form */}
                  <div className="flex items-end gap-3 mb-6">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Add new operator email</label>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          placeholder="operator@example.com"
                          value={newEmail}
                          onChange={(e) => { setNewEmail(e.target.value); setAddError(null); setAddSuccess(null); }}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
                          className="flex-1 h-10 px-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        />
                        <button
                          onClick={handleAddEmail}
                          disabled={addingEmail}
                          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {addingEmail ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                          Add
                        </button>
                      </div>
                      {addError && (
                        <p className="flex items-center gap-1.5 mt-2 text-xs text-red-600">
                          <AlertCircle className="size-3.5" /> {addError}
                        </p>
                      )}
                      {addSuccess && (
                        <p className="flex items-center gap-1.5 mt-2 text-xs text-emerald-600">
                          <Check className="size-3.5" /> {addSuccess}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Email list */}
                  {emailsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : emails.length === 0 ? (
                    <div className="text-center py-8 border-2 border-dashed border-border rounded-xl">
                      <Mail className="size-8 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">No operator emails configured</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Add an email above to grant operator access.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {emails.map((email) => (
                        <div key={email} className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors group">
                          <div className="flex items-center gap-3">
                            <Mail className="size-4 text-muted-foreground/60" />
                            <span className="text-sm font-medium">{email}</span>
                          </div>
                          <button
                            onClick={() => handleRemoveEmail(email)}
                            disabled={removingEmail === email}
                            className="p-1.5 rounded-md text-muted-foreground/40 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-30"
                            title="Remove email"
                          >
                            {removingEmail === email ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* API Configuration */}
              <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Server className="size-5 text-primary" /> Core Endpoints
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Routing and backend base URLs for the frontend application.
                  </p>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-semibold">AI_TUTOR_API_BASE_URL</label>
                      <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-4 font-mono text-sm break-all mt-1">
                        {settings.api_base_url}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-semibold">AI_TUTOR_OPERATOR_EMAIL_ROLES</label>
                      <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-4 font-mono text-sm break-all mt-1">
                        {settings.operator_roles || <span className="italic text-muted-foreground">Not configured (All operator logins disabled)</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          ) : null}

        </div>
      </div>
    </DashboardShell>
  );
}
