'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2, Plus, Users, CreditCard, ChevronRight, X } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const log = createLogger('AdminSchools');

interface School {
  id: string;
  name: string;
  admin_email: string;
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

export default function AdminSchoolsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create school form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPlan, setNewPlan] = useState('free');
  const [creating, setCreating] = useState(false);

  // School detail panel
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'billing'>('members');
  const [members, setMembers] = useState<SchoolMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invoices, setInvoices] = useState<SchoolInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  // Bulk provision
  const [bulkEmails, setBulkEmails] = useState('');
  const [provisioning, setProvisioning] = useState(false);

  // Billing
  const [generatingInvoice, setGeneratingInvoice] = useState(false);

  const fetchSchools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/schools', { cache: 'no-store' });
      if (res.status === 401) { router.push('/operator'); return; }
      if (!res.ok) throw new Error('Failed to fetch schools');
      const data = await res.json();
      if (data.success && data.schools) setSchools(data.schools);
    } catch (err) {
      log.error('Fetch schools failed', err);
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  const createSchool = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), admin_email: newEmail.trim(), plan: newPlan }),
      });
      if (!res.ok) throw new Error('Failed to create school');
      setShowCreate(false);
      setNewName(''); setNewEmail(''); setNewPlan('free');
      await fetchSchools();
    } catch (err) {
      alert('Failed to create school');
    } finally {
      setCreating(false);
    }
  };

  const openSchoolDetail = async (school: School) => {
    setSelectedSchool(school);
    setActiveTab('members');
    fetchMembers(school.id);
    fetchInvoices(school.id);
  };

  const fetchMembers = async (schoolId: string) => {
    setMembersLoading(true);
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
      const res = await fetch(`${apiBaseUrl}/api/admin/schools/${schoolId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      } else {
        setMembers([]);
      }
    } catch (err) {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  const fetchInvoices = async (schoolId: string) => {
    setInvoicesLoading(true);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/invoices`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(data || []);
      } else {
        setInvoices([]);
      }
    } catch (err) {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  };

  const handleBulkProvision = async () => {
    if (!selectedSchool || !bulkEmails.trim()) return;
    setProvisioning(true);
    try {
      const emails = bulkEmails.split(/[\n,]+/).map(e => e.trim()).filter(Boolean);
      const res = await fetch('/api/admin/schools/members/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: selectedSchool.id,
          emails,
          plan_code: selectedSchool.plan,
        }),
      });
      if (!res.ok) throw new Error('Failed to bulk provision');
      setBulkEmails('');
      await fetchMembers(selectedSchool.id);
      await fetchSchools();
    } catch (err) {
      alert('Bulk provisioning failed');
    } finally {
      setProvisioning(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!selectedSchool) return;
    setGeneratingInvoice(true);
    try {
      // Set due date to 30 days from now
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      const res = await fetch(`/api/admin/schools/${selectedSchool.id}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: selectedSchool.id,
          due_date: dueDate.toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Failed to generate invoice');
      await fetchInvoices(selectedSchool.id);
    } catch (err) {
      alert('Generating invoice failed');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  useEffect(() => { fetchSchools(); }, [router]);

  return (
    <div className="flex w-full min-h-[100dvh] bg-neutral-50 dark:bg-neutral-900/50">
      <EnterpriseSidebar
        variant="admin"
        onSignOut={async () => {
          try { await fetch('/api/operator/auth/logout', { method: 'POST' }); } catch (e) {}
          router.push('/operator');
        }}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <Building2 className="size-8 text-primary" />
                Enterprise Schools
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Manage schools, their plans, credit pools, and connected users.</p>
            </div>
            <Button onClick={() => setShowCreate(!showCreate)} className="gap-2">
              <Plus className="size-4" /> Create School
            </Button>
          </div>

          {/* Create School Form */}
          {showCreate && (
            <div className="rounded-2xl border border-primary/30 bg-white dark:bg-neutral-950 p-6 mb-8 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <h3 className="font-semibold text-lg mb-4">New School</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">School Name</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Hicore Academy"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Admin Email</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="admin@school.com"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-neutral-50 dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm" />
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
              <div className="flex justify-end gap-3 mt-6">
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={createSchool} disabled={creating || !newName.trim() || !newEmail.trim()}>
                  {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Create School
                </Button>
              </div>
            </div>
          )}

          {/* Schools Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p>Loading schools...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-6 text-red-600">{error}</div>
          ) : schools.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-white dark:bg-neutral-950 p-12 text-center">
              <Building2 className="size-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-lg font-semibold text-muted-foreground">No Schools Yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Create your first enterprise school to start managing users.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {schools.map(school => (
                <div key={school.id}
                  onClick={() => openSchoolDetail(school)}
                  className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-pointer group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="size-6 text-primary" />
                    </div>
                    <Badge variant="outline" className={cn(
                      "text-[10px] uppercase tracking-wider font-bold",
                      school.plan === 'enterprise' ? 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/30' :
                      school.plan === 'pro' ? 'border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/30' :
                      'border-neutral-300 text-neutral-500 bg-neutral-50 dark:bg-neutral-800'
                    )}>{school.plan}</Badge>
                  </div>
                  <h3 className="font-bold text-lg mb-1 group-hover:text-primary transition-colors">{school.name}</h3>
                  <p className="text-xs text-muted-foreground mb-4">{school.admin_email}</p>
                  <div className="flex items-center gap-6 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Users className="size-3.5" /> {school.member_count} users</span>
                    <span className="flex items-center gap-1.5"><CreditCard className="size-3.5" /> {school.credit_pool.toFixed(1)} credits</span>
                  </div>
                  <div className="flex justify-end mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight className="size-5 text-primary" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* School Detail Drawer */}
          {selectedSchool && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedSchool(null)} />
              <div className="relative w-full max-w-lg bg-white dark:bg-neutral-950 border-l border-border shadow-2xl overflow-y-auto animate-in slide-in-from-right-8 duration-300">
                <div className="p-6 border-b border-border/60 flex items-center justify-between sticky top-0 bg-white dark:bg-neutral-950 z-10">
                  <h2 className="text-xl font-bold">{selectedSchool.name}</h2>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSchool(null)}><X className="size-4" /></Button>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Plan</p>
                      <p className="font-bold capitalize text-lg">{selectedSchool.plan}</p>
                    </div>
                    <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Credit Pool</p>
                      <p className="font-bold text-lg">{selectedSchool.credit_pool.toFixed(1)}</p>
                    </div>
                    <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Members</p>
                      <p className="font-bold text-lg">{selectedSchool.member_count}</p>
                    </div>
                    <div className="rounded-xl bg-neutral-50 dark:bg-neutral-900 p-4">
                      <p className="text-xs text-muted-foreground mb-1">Admin</p>
                      <p className="font-medium text-sm truncate">{selectedSchool.admin_email}</p>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-border">
                    <button
                      className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'members' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setActiveTab('members')}
                    >
                      Members
                    </button>
                    <button
                      className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                        activeTab === 'billing' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setActiveTab('billing')}
                    >
                      Billing & Invoices
                    </button>
                  </div>

                  {activeTab === 'members' && (
                    <div className="space-y-6">
                      <div className="rounded-xl border border-border p-4 bg-neutral-50 dark:bg-neutral-900">
                        <h4 className="font-semibold text-sm mb-2">Bulk Provision Users</h4>
                        <p className="text-xs text-muted-foreground mb-3">Paste comma or newline separated email addresses to pre-register them for this school.</p>
                        <textarea
                          rows={3}
                          value={bulkEmails}
                          onChange={e => setBulkEmails(e.target.value)}
                          placeholder="student1@school.com, student2@school.com"
                          className="w-full rounded-lg border border-border p-2 text-sm bg-white dark:bg-neutral-950 mb-3"
                        />
                        <Button size="sm" onClick={handleBulkProvision} disabled={provisioning || !bulkEmails.trim()}>
                          {provisioning && <Loader2 className="size-3 animate-spin mr-2" />}
                          Provision Users
                        </Button>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="size-4" /> Connected Users</h3>
                        {membersLoading ? (
                          <div className="py-8 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin mx-auto" /></div>
                        ) : members.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic py-4">No members assigned to this school yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {members.map(m => (
                              <div key={m.account_id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-white dark:bg-neutral-950 text-sm">
                                <div>
                                  <p className="font-medium">{m.email}</p>
                                  <p className="text-xs text-muted-foreground">Joined: {new Date(m.created_at).toLocaleDateString()}</p>
                                </div>
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
                          <p className="text-xs text-muted-foreground mt-1">Calculates total based on connected users and active plans.</p>
                        </div>
                        <Button size="sm" onClick={handleGenerateInvoice} disabled={generatingInvoice}>
                          {generatingInvoice && <Loader2 className="size-3 animate-spin mr-2" />}
                          Generate
                        </Button>
                      </div>

                      <div>
                        <h3 className="font-semibold mb-3 flex items-center gap-2"><CreditCard className="size-4" /> Invoices</h3>
                        {invoicesLoading ? (
                          <div className="py-8 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin mx-auto" /></div>
                        ) : invoices.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic py-4">No invoices generated yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {invoices.map(inv => (
                              <div key={inv.id} className="flex items-center justify-between p-4 rounded-xl border border-border bg-white dark:bg-neutral-950">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-sm">${(inv.amount_cents / 100).toFixed(2)}</span>
                                    <Badge variant="outline" className={cn(
                                      "text-[10px] uppercase",
                                      inv.status === 'paid' ? "border-green-500 text-green-600 bg-green-50" : 
                                      inv.status === 'pending' ? "border-amber-500 text-amber-600 bg-amber-50" : ""
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
    </div>
  );
}
