'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users, Activity, CreditCard, TrendingUp, Settings, Database,
  Loader2, DollarSign, BarChart3, AlertTriangle, CheckCircle2,
  School, Receipt, Zap, ChevronRight, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

const log = createLogger('AdminConsole');

type Tab = 'overview' | 'revenue' | 'expenses' | 'schools';

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, currency = 'USD') {
  return currency === 'INR'
    ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }

function StatCard({ icon, label, value, sub, color = 'text-[#F97316]' }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col min-h-[140px] hover:shadow-md transition-all">
      <div className={`flex items-center gap-3 mb-4 ${color}`}>
        <div className="p-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800">
          {icon}
        </div>
        <h3 className="font-bold text-xs uppercase tracking-wider text-neutral-500">{label}</h3>
      </div>
      <div className="text-3xl font-black text-[#0F172A] dark:text-white">{value}</div>
      {sub && <p className="text-[10px] font-bold text-neutral-400 mt-2 uppercase tracking-tight">{sub}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data slices
  const [overview, setOverview] = useState<any>(null);
  const [apiCosts, setApiCosts] = useState<any>(null);
  const [schools, setSchools] = useState<any[]>([]);

  const headers = (): HeadersInit => {
    const tok = sessionStorage.getItem('adminBearerToken');
    return tok ? { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` } : { 'Content-Type': 'application/json' };
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [ovRes, costsRes, schoolsRes] = await Promise.all([
        fetch('/api/admin/overview', { headers: headers(), cache: 'no-store' }),
        fetch('/api/admin/api-costs', { headers: headers(), cache: 'no-store' }),
        fetch('/api/admin/schools', { headers: headers(), cache: 'no-store' }),
      ]);
      if (ovRes.status === 401) { router.push('/operator'); return; }
      if (ovRes.ok) setOverview(await ovRes.json());
      if (costsRes.ok) setApiCosts(await costsRes.json());
      if (schoolsRes.ok) {
        const d = await schoolsRes.json();
        setSchools(d.schools ?? []);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="size-4" /> },
    { id: 'revenue', label: 'Revenue', icon: <TrendingUp className="size-4" /> },
    { id: 'expenses', label: 'API Costs', icon: <DollarSign className="size-4" /> },
    { id: 'schools', label: 'Enterprise', icon: <School className="size-4" /> },
  ];

  return (
    <div className="flex w-full min-h-screen bg-[#F8FAFC] dark:bg-neutral-900/50">
      <EnterpriseSidebar variant="admin" onSignOut={async () => {
        try { await fetch('/api/operator/auth/logout', { method: 'POST' }); } catch {}
        router.push('/operator');
      }} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 pt-10">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[#0F172A] dark:text-white uppercase">Operator Console</h1>
              <p className="text-sm text-neutral-500 mt-1">Platform metrics, revenue, API costs, and enterprise management.</p>
            </div>
            <div className="flex items-center gap-3">
              {error && <span className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl font-medium">{error}</span>}
              <button 
                onClick={load} 
                disabled={loading}
                className="flex items-center gap-2 bg-[#F97316] text-white px-6 py-2.5 rounded-xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50"
              >
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Updating…' : 'Refresh Data'}
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mb-10 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-1.5 w-fit shadow-sm">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${tab === t.id ? 'bg-[#0F172A] text-white shadow-lg shadow-blue-900/20' : 'text-neutral-500 hover:text-[#0F172A] hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>

          {/* ── TAB: OVERVIEW ─────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={<Users className="size-5" />} label="Total Users" color="text-primary"
                  value={loading ? <Loader2 className="size-5 animate-spin opacity-40" /> : (overview?.users?.total_users ?? '—')}
                  sub={overview?.users ? `${overview.users.new_users_today} new today · ${overview.users.active_users_week} active this week` : undefined} />
                <StatCard icon={<Activity className="size-5" />} label="Active Subscriptions" color="text-blue-500"
                  value={loading ? <Loader2 className="size-5 animate-spin opacity-40" /> : (overview?.subscriptions?.active_subscriptions ?? '—')}
                  sub={overview?.subscriptions ? `${overview.subscriptions.churned_users_month} churned this month` : undefined} />
                <StatCard icon={<CreditCard className="size-5" />} label="Revenue (30d)" color="text-emerald-500"
                  value={loading ? <Loader2 className="size-5 animate-spin opacity-40" /> : (overview?.subscriptions ? fmt(overview.subscriptions.revenue_rolling_30d, 'INR') : '—')}
                  sub={overview?.subscriptions ? `${fmt(overview.subscriptions.revenue_monthly, 'INR')} this month` : undefined} />
                <StatCard icon={<DollarSign className="size-5" />} label="API Cost (30d)" color="text-amber-500"
                  value={loading ? <Loader2 className="size-5 animate-spin opacity-40" /> : (apiCosts ? fmt(apiCosts.total_cost_usd_30d ?? 0) : '—')}
                  sub={apiCosts ? `Net margin ≈ ${pct(apiCosts.estimated_margin_30d ?? 0)}` : undefined} />
              </div>

              {/* Promo stats */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/50">
                    <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Promo Code Performance</h3>
                    <Link href="/admin/promo" className="text-[10px] font-black uppercase tracking-widest text-[#F97316] hover:underline flex items-center gap-1">Detailed View <ChevronRight className="size-3" /></Link>
                  </div>
                  {loading ? (
                    <div className="p-16 text-center"><Loader2 className="size-6 animate-spin mx-auto text-[#F97316] mb-2" /><p className="text-sm text-neutral-400">Loading data...</p></div>
                  ) : overview?.promo_codes ? (
                    <div className="p-8 grid grid-cols-2 md:grid-cols-4 gap-8">
                      {[
                        ['Active Codes', `${overview.promo_codes.active_promo_codes}/${overview.promo_codes.total_promo_codes}`],
                        ['Total Redemptions', overview.promo_codes.total_redemptions],
                        ['Credits Granted', Math.round(overview.promo_codes.total_credits_granted)],
                        ['Avg Utilization', pct(overview.promo_codes.average_redemption_rate)],
                      ].map(([l, v]) => (
                        <div key={String(l)}>
                          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1">{l}</p>
                          <p className="text-2xl font-black text-[#0F172A] dark:text-white">{v}</p>
                        </div>
                      ))}
                    </div>
                  ) : <div className="p-16 text-center text-sm text-neutral-400">No promotion data available</div>}
                </div>

                <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white mb-6">System Health</h3>
                  {overview?.users && overview?.subscriptions ? (
                    <div className="space-y-4">
                      {[
                        ['Active Users (7d)', overview.users.active_users_week],
                        ['Successful Payments', overview.payments?.successful_payments ?? '—'],
                        ['Payment Success Rate', overview.payments ? pct(overview.payments.success_rate) : '—'],
                      ].map(([l, v]) => (
                        <div key={String(l)} className="flex items-center justify-between pb-3 border-b border-neutral-50 dark:border-neutral-900 last:border-0">
                          <span className="text-sm font-medium text-neutral-500">{l}</span>
                          <span className="text-sm font-black text-[#0F172A] dark:text-white">{v}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-4">
                        <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Global Status</span>
                        <div className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase flex items-center gap-1.5 border border-emerald-100">
                          <div className="size-1.5 rounded-full bg-emerald-600 animate-pulse" />
                          Operational
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-400 text-center py-12 italic">
                      {loading ? <Loader2 className="size-5 animate-spin mx-auto text-[#F97316]" /> : 'No real-time data'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: REVENUE ─────────────────────────────────────── */}
          {tab === 'revenue' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard icon={<CreditCard className="size-5" />} label="Total Revenue (INR)" color="text-emerald-500"
                  value={loading ? '…' : (overview?.payments ? fmt(overview.payments.total_revenue_inr ?? overview.payments.total_revenue, 'INR') : '—')}
                  sub="From Easebuzz (India)" />
                <StatCard icon={<DollarSign className="size-5" />} label="Total Revenue (USD)" color="text-blue-500"
                  value={loading ? '…' : (overview?.payments ? fmt(overview.payments.total_revenue_usd ?? 0) : '—')}
                  sub="From Stripe (international)" />
                <StatCard icon={<TrendingUp className="size-5" />} label="Payment Success Rate" color="text-purple-500"
                  value={loading ? '…' : (overview?.payments ? pct(overview.payments.success_rate) : '—')}
                  sub={overview?.payments ? `${overview.payments.successful_payments} of ${overview.payments.total_payments} payments` : undefined} />
              </div>

              {/* Per-user revenue table */}
              <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/50">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">User Revenue Breakdown</h3>
                  <Link href="/admin/users" className="text-[10px] font-black uppercase tracking-widest text-[#F97316] hover:underline flex items-center gap-1">All Users <ChevronRight className="size-3" /></Link>
                </div>
                {loading ? (
                  <div className="p-16 text-center"><Loader2 className="size-6 animate-spin opacity-40 mx-auto text-[#F97316]" /></div>
                ) : overview?.top_paying_users?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                        <tr>{['Email','Plan','Credits Used','Revenue Paid','API Cost','Margin'].map(h => <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                        {(overview.top_paying_users as any[]).map((u: any, i: number) => (
                          <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-[#0F172A] dark:text-white">{u.email ?? u.account_id}</td>
                            <td className="px-6 py-4"><span className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">{u.plan ?? 'free'}</span></td>
                            <td className="px-6 py-4 font-mono text-xs">{u.credits_used ?? 0}</td>
                            <td className="px-6 py-4 text-emerald-600 font-black">{fmt(u.revenue_inr ?? 0, 'INR')}</td>
                            <td className="px-6 py-4 text-rose-500 font-medium">{fmt(u.api_cost_usd ?? 0)}</td>
                            <td className="px-6 py-4 font-black text-[#0F172A] dark:text-white">{u.margin_pct !== undefined ? pct(u.margin_pct) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-16 text-center text-sm text-neutral-400 italic">No revenue data captured yet</div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: API COSTS ───────────────────────────────────── */}
          {tab === 'expenses' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard icon={<DollarSign className="size-5" />} label="Total API Cost (30d)" color="text-rose-600"
                  value={loading ? '…' : (apiCosts ? fmt(apiCosts.total_cost_usd_30d ?? 0) : '—')}
                  sub="Combined Infrastructure Spend" />
                <StatCard icon={<Zap className="size-5" />} label="Llm + Images" color="text-blue-600"
                  value={loading ? '…' : (apiCosts ? fmt(apiCosts.openrouter_cost_usd ?? 0) : '—')}
                  sub="Reasoning & Visual Assets" />
                <StatCard icon={<Activity className="size-5" />} label="Voice + Audio" color="text-purple-600"
                  value={loading ? '…' : (apiCosts ? fmt((apiCosts.groq_cost_usd ?? 0) + (apiCosts.tts_cost_usd ?? 0)) : '—')}
                  sub="Processing & Speech Synthesis" />
              </div>

              {/* Cost by component */}
              <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Infrastructure Breakdown</h3>
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-1">Token usage × Provider pricing rates</p>
                </div>
                {loading ? (
                  <div className="p-16 text-center"><Loader2 className="size-6 animate-spin opacity-40 mx-auto text-[#F97316]" /></div>
                ) : apiCosts?.by_component?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                        <tr>{['Component','Provider','Model','Requests','I/O Tokens','Cost (USD)'].map(h => (
                          <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                        {(apiCosts.by_component as any[]).map((c: any, i: number) => (
                          <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-[#0F172A] dark:text-white capitalize">{c.component}</td>
                            <td className="px-6 py-4 text-neutral-500 font-medium">{c.provider}</td>
                            <td className="px-6 py-4 text-[10px] text-neutral-400 font-mono tracking-tighter">{c.model_id}</td>
                            <td className="px-6 py-4 font-mono text-xs">{c.request_count?.toLocaleString()}</td>
                            <td className="px-6 py-4 text-[11px] text-neutral-500">
                              <span className="text-[#0F172A] dark:text-white font-bold">{c.input_tokens?.toLocaleString()}</span> / {c.output_tokens?.toLocaleString()}
                            </td>
                            <td className="px-6 py-4 font-black text-rose-500">{fmt(c.cost_usd ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-16 text-center text-sm text-neutral-400 italic">
                    {loading ? '' : 'Waiting for system utilization data...'}
                  </div>
                )}
              </div>

              {/* Per-user cost table */}
              <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
                  <h3 className="font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Resource Consumption per User</h3>
                </div>
                {apiCosts?.per_user?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                        <tr>{['User','Plan','Revenue','API Cost','Ratio','Status'].map(h => (
                          <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                        {(apiCosts.per_user as any[]).map((u: any, i: number) => {
                          const ratio = u.revenue_inr > 0 ? (u.api_cost_usd * 84) / u.revenue_inr : 0;
                          const risky = ratio > 0.7;
                          return (
                            <tr key={i} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-[#0F172A] dark:text-white">{u.email ?? u.account_id}</td>
                              <td className="px-6 py-4"><span className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider">{u.plan ?? 'free'}</span></td>
                              <td className="px-6 py-4 text-emerald-600 font-black">{fmt(u.revenue_inr ?? 0, 'INR')}</td>
                              <td className="px-6 py-4 text-rose-500 font-medium">{fmt(u.api_cost_usd ?? 0)}</td>
                              <td className="px-6 py-4 font-black">{ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : '—'}</td>
                              <td className="px-6 py-4">
                                {risky
                                  ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black uppercase border border-rose-100"><AlertTriangle className="size-3" /> High Spend</span>
                                  : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase border border-emerald-100"><CheckCircle2 className="size-3" /> Healthy</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-16 text-center text-sm text-neutral-400 italic">Analytical data pending usage patterns</div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: ENTERPRISE SCHOOLS ─────────────────────────── */}
          {tab === 'schools' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase tracking-tight text-[#0F172A] dark:text-white">Institution Registry</h2>
                <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase border border-blue-100">
                  {schools.length} total
                </span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-32"><Loader2 className="size-8 animate-spin text-[#F97316]" /></div>
              ) : schools.length === 0 ? (
                <div className="rounded-[3rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-20 text-center shadow-sm">
                  <div className="w-20 h-20 rounded-3xl bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center mx-auto mb-6 border border-neutral-100 dark:border-neutral-800">
                    <School className="size-8 text-neutral-300" />
                  </div>
                  <h3 className="text-lg font-bold text-[#0F172A] dark:text-white mb-2">No Active Partnerships</h3>
                  <p className="text-sm text-neutral-400 max-w-sm mx-auto">Schools appear here once they integrate with the enterprise API or submit the contact form.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {schools.map((school: any) => (
                    <div key={school.id} className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm hover:shadow-md transition-all">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                        <div className="flex items-center gap-5">
                          <div className="h-14 w-14 rounded-2xl bg-[#0F172A] flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
                            <School className="size-7 text-white" />
                          </div>
                          <div>
                            <h3 className="font-black text-xl text-[#0F172A] dark:text-white leading-tight">{school.name}</h3>
                            <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest mt-1">{school.admin_email}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:flex lg:items-center gap-8">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Seats</span>
                            <span className="text-lg font-black text-[#0F172A] dark:text-white">{school.member_count}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Credits</span>
                            <span className="text-lg font-black text-[#F97316]">{school.credit_pool?.toFixed(0)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Plan</span>
                            <span className="inline-flex px-2.5 py-1 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[10px] font-black uppercase tracking-wider">{school.plan ?? 'custom'}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Payment</span>
                            {school.latest_invoice ? (
                              <span className={cn(
                                "inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider",
                                school.latest_invoice.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 
                                school.latest_invoice.status === 'overdue' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                              )}>
                                {school.latest_invoice.status}
                              </span>
                            ) : <span className="text-[10px] font-bold text-neutral-300 italic">No Data</span>}
                          </div>
                        </div>

                        <Link href={`/admin/schools/${school.id}`}
                          className="flex items-center justify-center gap-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-6 py-3 text-sm font-black text-[#0F172A] dark:text-white hover:bg-[#0F172A] hover:text-white transition-all group shrink-0">
                          Configure <ChevronRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
