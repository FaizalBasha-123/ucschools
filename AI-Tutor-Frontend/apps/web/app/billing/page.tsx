'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, Download, Check, ArrowRight, Zap, Shield, Sparkles, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { verifyAuthSession, hasAuthSessionHint, clearAuthSession, authHeaders } from '@/lib/auth/session';

export default function BillingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [authChecking, setAuthChecking] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);

  const [dashboardData, setDashboardData] = useState<any>(null);

  useEffect(() => {
    const enforceAuthAndLoad = async () => {
      setAuthChecking(true);
      if (!hasAuthSessionHint()) {
        router.push('/auth?next=/billing');
        return;
      }
      try {
        const isValid = await verifyAuthSession();
        if (!isValid) {
          clearAuthSession();
          router.push('/auth?next=/billing');
          return;
        }
        setAuthChecking(false);
        
        const res = await fetch('/api/billing/dashboard', {
          headers: authHeaders(),
          cache: 'no-store'
        });
        if (res.ok) {
          const json = await res.json();
          setDashboardData(json.data);
        }
      } catch (err) {
        // Handle error
      } finally {
        setDataLoading(false);
      }
    };
    enforceAuthAndLoad();
  }, [router]);

  // If we are strictly checking auth, hide UI completely or show loading barrier
  if (authChecking) {
    return (
      <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-900/50 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const entitlement = dashboardData?.entitlement;
  const planName = entitlement?.active_subscription?.plan_code?.split('_')[0] || 'None';
  const planStatus = entitlement?.active_subscription?.status || 'Inactive';

  return (
    <div className="flex w-full min-h-screen bg-neutral-50 dark:bg-neutral-900/50">
      <EnterpriseSidebar onSignOut={() => {
        clearAuthSession();
        router.push('/auth?next=/billing');
      }} />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Usage & Billing</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage your active plans, usage limits, and invoices.</p>
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="outline" className="gap-2" disabled={dataLoading}>
                <Download className="size-4" />
                Download Invoices
              </Button>
            </div>
          </div>

          {/* Current Usage Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm min-h-[160px] flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <CreditCard className="size-5 text-emerald-500" />
                  <h3 className="font-medium text-sm text-foreground">Current Plan</h3>
                </div>
                {planName !== 'None' && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold uppercase">{planStatus}</span>}
              </div>
              <div className="flex-1 flex flex-col justify-center">
                {dataLoading ? (
                  <Loader2 className="size-5 animate-spin mx-auto text-emerald-500" />
                ) : (
                  <>
                    <p className="text-3xl font-extrabold capitalize">{planName}</p>
                    {planName === 'None' && (
                      <Link href="/pricing" className="text-sm text-emerald-600 font-medium mt-2 hover:underline">
                        View available plans →
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm min-h-[160px] flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Zap className="size-5 text-amber-500" />
                  <h3 className="font-medium text-sm text-foreground">Generation Credits</h3>
                </div>
                <Link href="/pricing" className="text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-1 rounded transition-colors">
                  Buy More
                </Link>
              </div>
              <div className="flex-1 flex flex-col justify-center">
                {dataLoading ? (
                  <Loader2 className="size-5 animate-spin mx-auto text-amber-500" />
                ) : (
                  <p className="text-4xl font-extrabold text-foreground">{entitlement?.credit_balance ?? 0}</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm min-h-[160px] flex flex-col relative overflow-hidden">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Sparkles className="size-5 text-primary" />
                <h3 className="font-medium text-sm text-foreground">Active Classrooms</h3>
              </div>
              <div className="flex-1 flex flex-col justify-center">
                {dataLoading ? (
                  <Loader2 className="size-5 animate-spin mx-auto text-primary" />
                ) : (
                  <p className="text-4xl font-extrabold text-foreground">{entitlement?.has_active_subscription ? 'Unlimited' : '0'}</p>
                )}
              </div>
            </div>
          </div>

          <h2 className="text-xl font-bold mb-6">Invoice History</h2>
          <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900 border-b border-border/60">
                <tr>
                  <th className="px-6 py-4 text-left font-medium text-muted-foreground">Invoice</th>
                  <th className="px-6 py-4 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-6 py-4 text-left font-medium text-muted-foreground">Amount</th>
                  <th className="px-6 py-4 text-left font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {dataLoading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                      <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                    </td>
                  </tr>
                ) : dashboardData?.recent_invoices?.length > 0 ? (
                  dashboardData.recent_invoices.map((inv: any) => (
                    <tr key={inv.id}>
                      <td className="px-6 py-4 font-mono text-xs">{inv.id}</td>
                      <td className="px-6 py-4">{new Date(inv.created_at).toLocaleDateString()}</td>
                      <td className="px-6 py-4">{inv.currency} {(inv.amount_minor / 100).toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 text-xs font-bold uppercase rounded",
                          inv.status === 'paid' ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-600"
                        )}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                      <p>No invoices found.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      </main>
    </div>
  );
}
