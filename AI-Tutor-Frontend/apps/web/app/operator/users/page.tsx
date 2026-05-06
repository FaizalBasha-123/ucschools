'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, Search, CreditCard, Ticket } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
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

export default function OperatorUsersPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<OperatorUser[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/operator/users', { cache: 'no-store' });
        if (res.status === 401) { router.push('/operator'); return; }
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
    };
    fetchUsers();
  }, [router]);

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
    <div className="flex w-full min-h-[100dvh] bg-[#F8FAFC] dark:bg-neutral-900/50">
      <EnterpriseSidebar 
        variant="operator"
        onSignOut={async () => {
          try { await fetch('/api/operator/auth/logout', { method: 'POST', headers: { 'X-Operator-Header': 'true' } }); } catch (e) {}
          router.push('/operator');
        }} 
      />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">
          
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
                    {['Account / Email','Phone','Billing Plan','Credit Balance','Joined Date','Enterprise'].map(h => (
                      <th key={h} className="px-6 py-4 font-black text-neutral-400 uppercase text-[10px] tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <Loader2 className="size-8 animate-spin mx-auto mb-4 text-[#10B981] opacity-60" />
                        <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Loading global directory...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="p-3 bg-rose-50 text-rose-600 rounded-xl inline-block border border-rose-100 font-bold text-xs uppercase mb-2">Sync Error</div>
                        <p className="text-sm text-neutral-500">{error}</p>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center text-neutral-400 italic">
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
      </main>
    </div>
  );
}
