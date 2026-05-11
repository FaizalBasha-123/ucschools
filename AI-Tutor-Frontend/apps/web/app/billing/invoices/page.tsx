'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2, Download, ExternalLink } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Header } from '@/components/header';
import { UserMenu } from '@/components/layout/user-menu';
import { CreditsDisplay } from '@/components/layout/credits-display';
import { SettingsDialog } from '@/components/settings';
import { verifyAuthSession, hasAuthSessionHint, clearAuthSession, authHeaders } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

export default function InvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardData, setDashboardData] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!hasAuthSessionHint()) { router.push('/auth?next=/billing/invoices'); return; }
      try {
        const isValid = await verifyAuthSession();
        if (!isValid) { clearAuthSession(); router.push('/auth?next=/billing/invoices'); return; }
        
        const res = await fetch('/api/billing/dashboard', {
          headers: authHeaders(),
          cache: 'no-store'
        });
        if (res.ok) {
          const json = await res.json();
          setDashboardData(json.data || json);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [router]);

  return (
    <DashboardShell
      onSignOut={() => {
        clearAuthSession();
        router.push('/auth?mode=signin');
      }}
      shellClassName="bg-neutral-50 dark:bg-neutral-950"
    >
      <Header 
        currentSceneTitle="Billing: Invoices" 
        rightElement={
          <div className="flex items-center gap-4">
            <CreditsDisplay />
            <div className="w-[1px] h-6 bg-neutral-200 dark:bg-neutral-800" />
            <UserMenu onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Invoice History</h1>
              <p className="text-sm text-neutral-500">View and download your past transaction records.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-800 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                <tr>
                  <th className="px-6 py-4">Invoice ID</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <Loader2 className="size-6 animate-spin mx-auto text-primary opacity-50" />
                    </td>
                  </tr>
                ) : dashboardData?.recent_invoices?.length > 0 ? (
                  dashboardData.recent_invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs">{inv.id}</td>
                      <td className="px-6 py-4 text-neutral-600 dark:text-neutral-400">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 font-semibold">
                        {inv.currency || '₹'} {(inv.amount_minor / 100).toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-0.5 text-[10px] font-bold uppercase rounded-full",
                          inv.status === 'paid' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        )}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-primary hover:text-primary/80 transition-colors">
                          <Download size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-neutral-400">
                      No invoices found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DashboardShell>
  );
}
