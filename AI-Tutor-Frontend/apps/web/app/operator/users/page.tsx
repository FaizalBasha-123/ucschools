'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, Search, CreditCard, Ticket, History, X, ArrowUpRight, ArrowDownRight, Coins, Plus, Minus, Check, AlertCircle } from 'lucide-react';
import { operatorSignOut, getOperatorToken, clearOperatorSession } from '@/lib/auth/session';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const log = createLogger('OperatorUsers');

interface OperatorUser {
  account_id: string;
  email: string | null;
  phone_number: string | null;
  created_at_unix: number;
  plan: string | null;
  credits: number;
  school_id: string | null;
  promo_codes_used: number;
}

interface LedgerEntry {
  id: string;
  kind: string;
  amount: number;
  reason: string;
  created_at: string;
}

function sourceType(reason: string): { label: string; color: string } {
  if (reason.startsWith('payment_order:')) return { label: 'PAID', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (reason.startsWith('Promo code redeemed:')) return { label: 'PROMO', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
  if (reason.startsWith('operator_grant:') || reason.startsWith('operator_debit:')) return { label: 'PROMO', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
  if (reason.startsWith('subscription_initial:') || reason.startsWith('subscription_renewal:')) return { label: 'SUBSCRIPTION', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' };
  if (reason.startsWith('free_payment_order:')) return { label: 'FREE', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  if (reason === 'starter_grant') return { label: 'STARTER', color: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' };
  if (reason.startsWith('lesson:')) return { label: 'DEBIT', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' };
  return { label: 'OTHER', color: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' };
}

function formatReason(reason: string): string {
  if (reason.startsWith('payment_order:')) {
    const parts = reason.split(':');
    return parts[1] || reason;
  }
  if (reason.startsWith('Promo code redeemed:')) return reason.replace('Promo code redeemed:', 'Promo:').trim();
  if (reason.startsWith('operator_grant:')) return `Operator: ${reason.slice('operator_grant:'.length).trim()}`;
  if (reason.startsWith('operator_debit:')) return `Operator: ${reason.slice('operator_debit:'.length).trim()}`;
  if (reason.startsWith('lesson:')) return `Lesson ${reason.split(' ')[0].split(':')[1]?.slice(0, 8) || ''}`;
  if (reason.startsWith('subscription_initial:')) return `Initial: ${reason.split(':')[1] || ''}`;
  if (reason.startsWith('subscription_renewal:')) return 'Monthly Renewal';
  if (reason === 'starter_grant') return 'Starter Grant';
  return reason;
}

function HistoryModal({ accountId, email, onClose }: { accountId: string; email: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLedger = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/operator/users/${accountId}/ledger`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch ledger');
        const data = await res.json();
        if (data.success && data.entries) {
          setEntries(data.entries);
        }
      } catch (err) {
        log.error('Failed to fetch ledger', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLedger();
  }, [accountId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
        <div className="flex items-center justify-between p-6 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] dark:text-white uppercase tracking-tight">Credit History</h2>
            <p className="text-xs text-neutral-500 mt-0.5">{email || accountId}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <X className="size-5 text-neutral-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center py-16">
              <Loader2 className="size-8 animate-spin text-[#10B981] mb-4" />
              <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Loading ledger...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <History className="size-10 mx-auto mb-3 text-neutral-300" />
              <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest">No credit transactions yet</p>
              <p className="text-xs text-neutral-400 mt-1">This user has no credit history.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="pb-3 font-black text-neutral-400 uppercase text-[10px] tracking-widest">Date</th>
                  <th className="pb-3 font-black text-neutral-400 uppercase text-[10px] tracking-widest">Type</th>
                  <th className="pb-3 font-black text-neutral-400 uppercase text-[10px] tracking-widest text-right">Amount</th>
                  <th className="pb-3 font-black text-neutral-400 uppercase text-[10px] tracking-widest">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                {entries.map((entry) => {
                  const src = sourceType(entry.reason);
                  const isCredit = entry.kind === 'grant' || entry.kind === 'refund';
                  return (
                    <tr key={entry.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                      <td className="py-3.5 pr-4 text-neutral-600 dark:text-neutral-400 text-xs whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 pr-4">
                        <span className={cn("inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider", src.color)}>
                          {src.label}
                        </span>
                      </td>
                      <td className={cn("py-3.5 pr-4 text-right font-black text-sm whitespace-nowrap", isCredit ? "text-emerald-600" : "text-rose-600")}>
                        <span className="inline-flex items-center gap-1">
                          {isCredit ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                          {isCredit ? '+' : '-'}{entry.amount.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3.5 text-neutral-500 text-xs max-w-[200px] truncate" title={entry.reason}>
                        {formatReason(entry.reason)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="p-4 border-t border-neutral-100 dark:border-neutral-800 text-center">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs font-bold uppercase tracking-widest">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreditModal({
  user,
  onClose,
  onSuccess,
}: {
  user: OperatorUser;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const numAmount = parseFloat(amount) || 0;
  const isNegative = numAmount < 0;
  const newBalance = user.credits + numAmount;

  const handleSubmit = async () => {
    if (numAmount === 0) {
      setError('Amount must be non-zero');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/operator/users/${user.account_id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numAmount,
          reason: reason.trim() || 'manual adjustment',
        }),
      });
      if (res.status === 401) { clearOperatorSession(); return; }
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to adjust credits');
      }
      setSuccess(`Balance updated: ${user.credits.toFixed(1)} → ${data.new_balance?.toFixed(1) || newBalance.toFixed(1)}`);
      setTimeout(() => { onSuccess(); onClose(); }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust credits');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Coins className="size-5 text-blue-500" /> Adjust Credits
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5 truncate max-w-[300px]">{user.email || user.account_id}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <X className="size-5 text-neutral-400" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Current Balance */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-800">
            <span className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Current Balance</span>
            <span className="text-lg font-black text-[#10B981]">{user.credits.toFixed(1)}</span>
          </div>

          {/* Amount Input */}
          <div>
            <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1.5 block">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 font-bold text-sm">$</span>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null); setSuccess(null); }}
                className="w-full h-11 pl-7 pr-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold transition-all"
              />
            </div>
            <div className="flex gap-2 mt-2">
              {[-50, -10, -5, 5, 10, 50].map((v) => (
                <button
                  key={v}
                  onClick={() => { setAmount(String(v)); setError(null); setSuccess(null); }}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all",
                    v < 0
                      ? "border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      : "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900/50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                  )}
                >
                  {v > 0 ? '+' : ''}{v}
                </button>
              ))}
            </div>
          </div>

          {/* Reason Input */}
          <div>
            <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-1.5 block">Reason</label>
            <input
              type="text"
              placeholder="manual adjustment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-all"
            />
          </div>

          {/* Preview */}
          {amount && !isNaN(numAmount) && numAmount !== 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-100 dark:border-neutral-800">
              <span className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Preview</span>
              <span className="text-sm font-black">
                <span className="text-neutral-400">{user.credits.toFixed(1)}</span>
                <span className="text-neutral-300 mx-1">→</span>
                <span className={isNegative ? 'text-rose-600' : 'text-emerald-600'}>
                  {newBalance.toFixed(1)}
                </span>
                <span className={cn("ml-2 text-xs", isNegative ? "text-rose-400" : "text-emerald-400")}>
                  ({isNegative ? '' : '+'}{numAmount.toFixed(1)})
                </span>
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50">
              <AlertCircle className="size-4 text-rose-500 shrink-0" />
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400">{error}</span>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
              <Check className="size-4 text-emerald-500 shrink-0" />
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{success}</span>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-neutral-100 dark:border-neutral-800 flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting} className="text-xs font-bold uppercase tracking-widest">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !amount || isNaN(numAmount) || numAmount === 0}
            className={cn(
              "text-xs font-black uppercase tracking-widest shadow-sm",
              isNegative
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : isNegative ? <Minus className="size-4" /> : <Plus className="size-4" />}
            {submitting ? 'Applying...' : isNegative ? 'Remove Credits' : 'Add Credits'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function OperatorUsersPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [search, setSearch] = useState('');
  const [historyUser, setHistoryUser] = useState<OperatorUser | null>(null);
  const [creditUser, setCreditUser] = useState<OperatorUser | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/users', { cache: 'no-store' });
      if (res.status === 401) { clearOperatorSession(); router.push('/operator/login'); return; }
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      if (data.success && data.users) {
        setUsers(data.users);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      log.error('Failed to fetch users', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = users.filter(user =>
    search === '' ||
    user.email?.toLowerCase().includes(search.toLowerCase()) ||
    user.account_id.toLowerCase().includes(search.toLowerCase()) ||
    (user.plan || '').toLowerCase().includes(search.toLowerCase()) ||
    (user.phone_number || '').toLowerCase().includes(search.toLowerCase())
  );

  const planColor = (plan: string | null) => {
    if (!plan || plan === 'free') return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
    if (plan === 'pro') return 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400';
    return 'bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400';
  };

  return (
    <DashboardShell
      variant="operator"
      onSignOut={async () => {
        await operatorSignOut();
        router.push('/operator/login');
      }}
      shellClassName="bg-[#F8FAFC] dark:bg-neutral-900/50"
    >
      <div className="flex-1 overflow-y-auto p-8 pt-12">
        <div className="max-w-6xl mx-auto">

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[#0F172A] dark:text-white uppercase flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-[#10B981]">
                  <Users className="size-8" />
                </div>
                User Management
              </h1>
              <p className="text-sm text-neutral-500 mt-1">View and manage registered accounts, plans, and credit balances.</p>
            </div>
          </div>

          <div className="rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
            <div className="p-6 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Search by email, ID, or plan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#10B981] text-sm transition-all"
                />
              </div>
              <div className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-auto">
                {filteredUsers.length} Users Listed
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-[#F8FAFC] dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800">
                  <tr>
                    {['Account / Email', 'Phone', 'Billing Plan', 'Credit Balance', 'Joined Date', 'Enterprise', 'Actions'].map(h => (
                      <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center">
                        <Loader2 className="size-8 animate-spin mx-auto mb-4 text-[#10B981] opacity-60" />
                        <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Loading global directory...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center">
                        <div className="p-3 bg-rose-50 text-rose-600 rounded-xl inline-block border border-rose-100 font-bold text-xs uppercase mb-2">Sync Error</div>
                        <p className="text-sm text-neutral-500">{error}</p>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-16 text-center text-neutral-400 italic">
                        No accounts match your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.account_id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                        <td className="px-6 py-5">
                          <div className="font-bold text-[#0F172A] dark:text-white leading-tight">{user.email || <span className="text-neutral-300 italic font-normal">Hidden Identity</span>}</div>
                          <div className="font-mono text-[9px] text-neutral-400 mt-1 uppercase tracking-tighter">{user.account_id}</div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="font-bold text-neutral-600 dark:text-neutral-400">
                            {user.phone_number || <span className="text-neutral-300 italic font-normal text-xs uppercase tracking-widest">Unlinked</span>}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1.5">
                            <Badge variant="outline" className={cn("px-2.5 py-1 text-[10px] font-black uppercase tracking-wider border-0 shadow-sm", planColor(user.plan))}>
                              {user.plan || 'Free'}
                            </Badge>
                            {user.promo_codes_used > 0 && (
                              <div
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase border border-emerald-100 cursor-help"
                                title={`Redeemed ${user.promo_codes_used} promo codes`}
                              >
                                <Ticket className="size-2.5" />
                                {user.promo_codes_used} PROMOS USED
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2 font-black text-[#10B981] text-lg leading-none">
                            <CreditCard className="size-4 opacity-40" />
                            {user.credits.toFixed(1)}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-neutral-500 font-medium text-xs">
                          {new Date(user.created_at_unix * 1000).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-5">
                          {user.school_id ? (
                            <div className="px-3 py-1 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg text-[10px] font-black uppercase inline-block">
                              ID: {user.school_id.slice(0, 8)}
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-neutral-300 uppercase tracking-widest">Personal</span>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setCreditUser(user)}
                              className="p-2 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-neutral-400 hover:text-blue-600"
                              title="Adjust credits"
                            >
                              <Coins className="size-4" />
                            </button>
                            <button
                              onClick={() => setHistoryUser(user)}
                              className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-neutral-400 hover:text-[#10B981]"
                              title="View credit history"
                            >
                              <History className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-5 border-t border-neutral-100 dark:border-neutral-800 bg-[#F8FAFC] dark:bg-neutral-900/50 text-[10px] font-bold text-neutral-400 uppercase tracking-widest flex justify-between items-center">
              <span>Showing directory index · {filteredUsers.length} of {users.length} active users</span>
              <div className="flex items-center gap-2">
                <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Cloud Data Sync
              </div>
            </div>
          </div>
        </div>
      </div>

      {historyUser && (
        <HistoryModal
          accountId={historyUser.account_id}
          email={historyUser.email}
          onClose={() => setHistoryUser(null)}
        />
      )}

      {creditUser && (
        <CreditModal
          user={creditUser}
          onClose={() => setCreditUser(null)}
          onSuccess={fetchUsers}
        />
      )}
    </DashboardShell>
  );
}
