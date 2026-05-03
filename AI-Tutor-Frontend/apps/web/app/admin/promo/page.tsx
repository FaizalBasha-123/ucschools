'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ticket, Loader2, Plus, Search, Calendar, Users, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const log = createLogger('AdminPromo');

interface PromoCode {
  code: string;
  grant_credits: number;
  max_redemptions: number | null;
  redeemed_by_accounts: string[];
  expires_at: string | null;
  created_at: string;
}

export default function AdminPromoPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [search, setSearch] = useState('');
  
  // Create Form State
  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [credits, setCredits] = useState(50);
  const [maxUses, setMaxUses] = useState('');
  const [expiry, setExpiry] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const headers = (): HeadersInit => {
    const tok = sessionStorage.getItem('adminBearerToken');
    return tok ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` } : { 'Content-Type': 'application/json' };
  };

  const fetchPromos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/promo-codes', { headers: headers(), cache: 'no-store' });
      if (res.status === 401) { router.push('/operator'); return; }
      if (!res.ok) throw new Error('Failed to fetch promo codes');
      const data = await res.json();
      setPromoCodes(data.promo_codes || []);
    } catch (err: any) {
      log.error('Fetch promos failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPromos(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          code: newCode.toUpperCase().trim(),
          grant_credits: Number(credits),
          max_redemptions: maxUses ? Number(maxUses) : null,
          expires_at: expiry ? new Date(expiry).toISOString() : null,
        })
      });
      if (!res.ok) throw new Error('Failed to create promo code');
      
      setMessage({ type: 'success', text: `Promo code ${newCode} created successfully!` });
      setNewCode('');
      setCredits(50);
      setMaxUses('');
      setExpiry('');
      setShowCreate(false);
      fetchPromos();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setCreateLoading(false);
    }
  };

  const filtered = promoCodes.filter(p => p.code.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex w-full min-h-screen bg-[#F8FAFC] dark:bg-neutral-900/50">
      <EnterpriseSidebar variant="admin" onSignOut={() => router.push('/operator')} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 pt-10">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[#0F172A] dark:text-white uppercase">Promo Management</h1>
              <p className="text-sm text-neutral-500 mt-1">Create and monitor promotional credits for users and institutions.</p>
            </div>
            <button 
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 bg-[#F97316] text-white px-6 py-3 rounded-xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20"
            >
              <Plus className="size-5" />
              {showCreate ? 'Cancel' : 'New Promo Code'}
            </button>
          </div>

          {message && (
            <div className={cn(
              "mb-8 p-4 rounded-xl flex items-center gap-3 font-medium text-sm",
              message.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
            )}>
              {message.type === 'success' ? <CheckCircle2 className="size-5" /> : <AlertCircle className="size-5" />}
              {message.text}
            </div>
          )}

          {/* Create Form */}
          {showCreate && (
            <div className="mb-8 p-8 rounded-[2rem] bg-[#0F172A] text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Ticket size={120} />
              </div>
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Ticket className="size-5 text-[#F97316]" /> Create New Promotion
              </h2>
              <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Code</label>
                  <input 
                    required 
                    value={newCode} 
                    onChange={e => setNewCode(e.target.value)}
                    placeholder="E.g. SUMMER2026"
                    className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316] uppercase font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Credits</label>
                  <input 
                    required 
                    type="number"
                    value={credits} 
                    onChange={e => setCredits(Number(e.target.value))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Max Uses (Empty = Unlimited)</label>
                  <input 
                    type="number"
                    value={maxUses} 
                    onChange={e => setMaxUses(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-white/50">Expiry Date</label>
                  <input 
                    type="date"
                    value={expiry} 
                    onChange={e => setExpiry(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F97316]"
                  />
                </div>
                <div className="md:col-span-2 lg:col-span-4 flex justify-end mt-4">
                  <button 
                    disabled={createLoading}
                    className="bg-[#F97316] text-white px-10 py-3 rounded-xl font-bold hover:bg-orange-600 transition-all flex items-center gap-2"
                  >
                    {createLoading ? <Loader2 className="size-5 animate-spin" /> : "Save Promo Code"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* List Section */}
          <div className="bg-white dark:bg-neutral-950 rounded-[2rem] shadow-sm border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
                <input 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search promo codes..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 focus:outline-none focus:ring-2 focus:ring-[#F97316]"
                />
              </div>
              <div className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
                {filtered.length} Promo Codes Found
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                  <tr>
                    <th className="px-6 py-4 font-bold text-neutral-500 uppercase text-[10px]">Promo Code</th>
                    <th className="px-6 py-4 font-bold text-neutral-500 uppercase text-[10px]">Credits</th>
                    <th className="px-6 py-4 font-bold text-neutral-500 uppercase text-[10px]">Utilization</th>
                    <th className="px-6 py-4 font-bold text-neutral-500 uppercase text-[10px]">Status</th>
                    <th className="px-6 py-4 font-bold text-neutral-500 uppercase text-[10px]">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <Loader2 className="size-6 animate-spin mx-auto text-[#F97316] mb-2" />
                        <p className="text-neutral-400">Loading promo codes...</p>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-neutral-400">No promo codes found.</td>
                    </tr>
                  ) : (
                    filtered.map((p) => {
                      const isExpired = p.expires_at && new Date(p.expires_at) < new Date();
                      const isExhausted = p.max_redemptions && p.redeemed_by_accounts.length >= p.max_redemptions;
                      const active = !isExpired && !isExhausted;

                      return (
                        <tr key={p.code} className="hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600">
                                <Ticket className="size-4" />
                              </div>
                              <span className="font-mono font-black text-lg text-[#0F172A] dark:text-white">{p.code}</span>
                            </div>
                          </td>
                          <td className="px-6 py-5 font-bold text-emerald-600">+{p.grant_credits}</td>
                          <td className="px-6 py-5 text-neutral-600">
                            <div className="flex flex-col gap-1">
                              <span className="font-bold">{p.redeemed_by_accounts.length} / {p.max_redemptions || '∞'}</span>
                              <div className="w-24 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-[#F97316]" 
                                  style={{ width: `${p.max_redemptions ? (p.redeemed_by_accounts.length / p.max_redemptions) * 100 : 0}%` }} 
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            {active ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-700 text-[10px] font-black uppercase">
                                <CheckCircle2 className="size-3" /> Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase">
                                <Trash2 className="size-3" /> {isExhausted ? 'Exhausted' : 'Expired'}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-5 text-neutral-400 text-xs">
                            {new Date(p.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
