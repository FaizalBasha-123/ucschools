'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, GraduationCap, Landmark, Briefcase, Loader2, Plus, Users, CreditCard, ChevronRight, X, BookOpen } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { operatorSignOut, clearOperatorSession } from '@/lib/auth/session';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const log = createLogger('OperatorSchools');

type InstitutionType = 'school' | 'academy' | 'institution' | 'enterprise';

interface Enterprise {
  id: string;
  name: string;
  operator_email: string;
  institution_type: InstitutionType;
  description: string | null;
  plan: string;
  credit_pool: number;
  member_count: number;
  created_at: string;
}

interface SchoolInvoice {
  id: string;
  amount_cents: number;
  payment_link: string | null;
  status: string;
  due_at: string;
  created_at: string;
  paid_at: string | null;
}

interface SchoolMember {
  account_id: string;
  email: string;
  plan: string | null;
  credits: number;
  created_at: string;
}

const INSTITUTION_ICONS: Record<InstitutionType, React.ReactNode> = {
  school: <GraduationCap className="size-6" />,
  academy: <BookOpen className="size-6" />,
  institution: <Landmark className="size-6" />,
  enterprise: <Briefcase className="size-6" />,
};

const INSTITUTION_LABELS: Record<InstitutionType, string> = {
  school: 'School',
  academy: 'Academy',
  institution: 'Institution',
  enterprise: 'Enterprise',
};

export default function OperatorSchoolsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newType, setNewType] = useState<InstitutionType>('school');
  const [newDescription, setNewDescription] = useState('');
  const [newPlan, setNewPlan] = useState('free');
  const [creating, setCreating] = useState(false);

  // Detail panel
  const [selected, setSelected] = useState<Enterprise | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'billing'>('members');
  const [members, setMembers] = useState<SchoolMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invoices, setInvoices] = useState<SchoolInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [bulkEmails, setBulkEmails] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  const fetchEnterprises = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/schools', { cache: 'no-store' });
      if (res.status === 401) { clearOperatorSession(); router.push('/operator/login'); return; }
      if (!res.ok) throw new Error(`Failed to fetch enterprises (${res.status})`);
      const data = await res.json();
      if (data.success && data.schools) setEnterprises(data.schools);
    } catch (err) {
      log.error('Fetch enterprises failed', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const createEnterprise = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/operator/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          operator_email: newEmail.trim(),
          institution_type: newType,
          description: newDescription.trim() || null,
          plan: newPlan,
        }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setShowCreate(false);
      setNewName(''); setNewEmail(''); setNewType('school');
      setNewDescription(''); setNewPlan('free');
      await fetchEnterprises();
    } catch {
      alert('Failed to create enterprise');
    } finally {
      setCreating(false);
    }
  };

  const fetchMembers = async (id: string) => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/operator/schools/${id}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else setMembers([]);
    } catch { setMembers([]); }
    finally { setMembersLoading(false); }
  };

  const fetchInvoices = async (id: string) => {
    setInvoicesLoading(true);
    try {
      const res = await fetch(`/api/operator/schools/${id}/invoices`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.data || []);
      } else setInvoices([]);
    } catch { setInvoices([]); }
    finally { setInvoicesLoading(false); }
  };

  const openDetail = (ent: Enterprise) => {
    setSelected(ent);
    setActiveTab('members');
    fetchMembers(ent.id);
    fetchInvoices(ent.id);
  };

  const handleBulkProvision = async () => {
    if (!selected || !bulkEmails.trim()) return;
    setProvisioning(true);
    try {
      const emails = bulkEmails.split(/[\n,]+/).map(e => e.trim()).filter(Boolean);
      const res = await fetch('/api/operator/schools/members/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: selected.id, emails, plan_code: selected.plan }),
      });
      if (!res.ok) throw new Error('Failed');
      setBulkEmails('');
      await fetchMembers(selected.id);
      await fetchEnterprises();
    } catch { alert('Bulk provisioning failed'); }
    finally { setProvisioning(false); }
  };

  const handleGenerateInvoice = async () => {
    if (!selected) return;
    setGeneratingInvoice(true);
    try {
      const due = new Date(); due.setDate(due.getDate() + 30);
      const res = await fetch(`/api/operator/schools/${selected.id}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: selected.id, due_date: due.toISOString() }),
      });
      if (!res.ok) throw new Error('Failed');
      await fetchInvoices(selected.id);
    } catch { alert('Generating invoice failed'); }
    finally { setGeneratingInvoice(false); }
  };

  useEffect(() => { fetchEnterprises(); }, [router]);

  const planColor = (plan: string) => {
    if (plan === 'enterprise') return 'border-teal-400 text-teal-600 bg-teal-50 dark:bg-teal-950/30 dark:text-teal-400';
    if (plan === 'pro') return 'border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400';
    return 'border-neutral-300 text-neutral-500 bg-neutral-50 dark:bg-neutral-800';
  };

  return (
    <DashboardShell
      variant="operator"
      onSignOut={async () => { await operatorSignOut(); router.push('/operator/login'); }}
      shellClassName="bg-neutral-50 dark:bg-neutral-900/50"
    >
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <Building2 className="size-8 text-primary" />
                Enterprises
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage schools, academies, and institutions — their plans, credit pools, and connected users.
              </p>
            </div>
            <Button onClick={() => setShowCreate(!showCreate)} className="gap-2">
              <Plus className="size-4" /> Add Enterprise
            </Button>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="rounded-2xl border border-primary/30 bg-white dark:bg-neutral-950 p-6 mb-8 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <h3 className="font-semibold text-lg mb-5">New Enterprise</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Name *</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Hicore Academy"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Admin Email *</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="admin@org.com"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Type</label>
                  <select value={newType} onChange={e => setNewType(e.target.value as InstitutionType)}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm">
                    <option value="school">School</option>
                    <option value="academy">Academy</option>
                    <option value="institution">Institution</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Plan</label>
                  <select value={newPlan} onChange={e => setNewPlan(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
              </div>
              <div className="mb-5">
                <label className="text-xs text-muted-foreground font-medium block mb-1.5">Description (optional)</label>
                <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Brief notes about this organization..."
                  className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm" />
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={createEnterprise} disabled={creating || !newName.trim() || !newEmail.trim()}>
                  {creating && <Loader2 className="size-4 animate-spin mr-2" />}
                  Create
                </Button>
              </div>
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p>Loading enterprises...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-6 text-red-600 text-sm">{error}</div>
          ) : enterprises.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-white dark:bg-neutral-950 p-12 text-center">
              <Building2 className="size-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-lg font-semibold text-muted-foreground">No Enterprises Yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Add your first school, academy or institution to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {enterprises.map(ent => (
                <div key={ent.id} onClick={() => openDetail(ent)}
                  className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                      {INSTITUTION_ICONS[ent.institution_type ?? 'school']}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider font-bold', planColor(ent.plan))}>
                        {ent.plan}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                        {INSTITUTION_LABELS[ent.institution_type ?? 'school']}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-bold text-lg mb-0.5 group-hover:text-primary transition-colors">{ent.name}</h3>
                  <p className="text-xs text-muted-foreground mb-1">{ent.operator_email}</p>
                  {ent.description && (
                    <p className="text-xs text-muted-foreground/70 mb-3 line-clamp-1 italic">{ent.description}</p>
                  )}
                  <div className="flex items-center gap-5 text-xs text-muted-foreground mt-3">
                    <span className="flex items-center gap-1.5"><Users className="size-3.5" /> {ent.member_count} users</span>
                    <span className="flex items-center gap-1.5"><CreditCard className="size-3.5" /> {ent.credit_pool.toFixed(1)} credits</span>
                  </div>
                  <div className="flex justify-end mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="size-5 text-primary" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detail Drawer */}
          {selected && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSelected(null)} />
              <div className="relative w-full max-w-lg bg-white dark:bg-neutral-950 border-l border-border shadow-2xl overflow-y-auto animate-in slide-in-from-right-8 duration-300">
                <div className="p-6 border-b border-border/60 flex items-center justify-between sticky top-0 bg-white dark:bg-neutral-950 z-10">
                  <div>
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    <span className="text-xs text-muted-foreground capitalize">{INSTITUTION_LABELS[selected.institution_type ?? 'school']}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}><X className="size-4" /></Button>
                </div>

                <div className="p-6 space-y-6">
                  {selected.description && (
                    <p className="text-sm text-muted-foreground bg-neutral-50 dark:bg-neutral-900 rounded-xl px-4 py-3 italic border border-border/50">
                      {selected.description}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'Plan', value: <span className="font-bold capitalize text-lg">{selected.plan}</span> },
                      { label: 'Credit Pool', value: <span className="font-bold text-lg">{selected.credit_pool.toFixed(1)}</span> },
                      { label: 'Members', value: <span className="font-bold text-lg">{selected.member_count}</span> },
                      { label: 'Admin', value: <span className="font-medium text-sm truncate">{selected.operator_email}</span> },
                    ].map(item => (
                      <div key={item.label} className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-4">
                        <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                        {item.value}
                      </div>
                    ))}
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-border">
                    {(['members', 'billing'] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
                          activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                        {tab === 'billing' ? 'Billing & Invoices' : 'Members'}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'members' && (
                    <div className="space-y-6">
                      <div className="rounded-xl border border-border p-4 bg-neutral-50 dark:bg-neutral-900">
                        <h4 className="font-semibold text-sm mb-1">Bulk Provision Users</h4>
                        <p className="text-xs text-muted-foreground mb-3">Paste comma or newline-separated emails to pre-register them.</p>
                        <textarea rows={3} value={bulkEmails} onChange={e => setBulkEmails(e.target.value)}
                          placeholder="student1@org.com, student2@org.com"
                          className="w-full rounded-lg border border-border p-2 text-sm bg-white dark:bg-neutral-950 mb-3" />
                        <Button size="sm" onClick={handleBulkProvision} disabled={provisioning || !bulkEmails.trim()}>
                          {provisioning && <Loader2 className="size-3 animate-spin mr-2" />}
                          Provision Users
                        </Button>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="size-4" /> Connected Users</h3>
                        {membersLoading ? (
                          <div className="py-8 text-center"><Loader2 className="size-5 animate-spin mx-auto text-primary" /></div>
                        ) : members.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic py-4">No members assigned yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {members.map(m => (
                              <div key={m.account_id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-white dark:bg-neutral-950 text-sm">
                                <div>
                                  <p className="font-medium">{m.email}</p>
                                  <p className="text-xs text-muted-foreground">Joined: {new Date(m.created_at).toLocaleDateString()}</p>
                                </div>
                                {m.plan && <Badge variant="outline" className="text-[10px]">{m.plan}</Badge>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'billing' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl p-4">
                        <div>
                          <h4 className="font-semibold text-sm">Generate Monthly Invoice</h4>
                          <p className="text-xs text-muted-foreground mt-1">Calculates based on connected users and active plans.</p>
                        </div>
                        <Button size="sm" onClick={handleGenerateInvoice} disabled={generatingInvoice}>
                          {generatingInvoice && <Loader2 className="size-3 animate-spin mr-2" />}
                          Generate
                        </Button>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2"><CreditCard className="size-4" /> Invoices</h3>
                        {invoicesLoading ? (
                          <div className="py-8 text-center"><Loader2 className="size-5 animate-spin mx-auto text-primary" /></div>
                        ) : invoices.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic py-4">No invoices generated yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {invoices.map(inv => (
                              <div key={inv.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-white dark:bg-neutral-950">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-sm">${(inv.amount_cents / 100).toFixed(2)}</span>
                                    <Badge variant="outline" className={cn('text-[10px] uppercase',
                                      inv.status === 'paid' ? 'border-green-500 text-green-600 bg-green-50' :
                                      inv.status === 'pending' ? 'border-teal-500 text-teal-600 bg-teal-50' : ''
                                    )}>{inv.status}</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">Due: {new Date(inv.due_at).toLocaleDateString()}</p>
                                </div>
                                {inv.payment_link && inv.status !== 'paid' && (
                                  <Button variant="outline" size="sm" asChild>
                                    <a href={inv.payment_link} target="_blank" rel="noreferrer">Pay Link</a>
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}
