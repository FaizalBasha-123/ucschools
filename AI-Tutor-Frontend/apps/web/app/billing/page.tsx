'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, Download, Check, ArrowRight, Zap, Shield, Sparkles, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { verifyAuthSession, hasAuthSessionHint, clearAuthSession } from '@/lib/auth/session';

export default function BillingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [authChecking, setAuthChecking] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    const enforceAuth = async () => {
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
        // Authentication passed
        setAuthChecking(false);
      } catch (err) {
        clearAuthSession();
        router.push('/auth?next=/billing');
      }
    };
    enforceAuth();
  }, [router]);

  // If we are strictly checking auth, hide UI completely or show loading barrier
  if (authChecking) {
    return (
      <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-900/50 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

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
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <CreditCard className="size-5 text-emerald-500" />
                <h3 className="font-medium text-sm text-foreground">Current Plan</h3>
              </div>
              <div className="flex-1 flex items-center justify-center opacity-50">
                <span className="text-sm italic">Pending API connection...</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm min-h-[160px] flex flex-col relative overflow-hidden">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Zap className="size-5 text-amber-500" />
                <h3 className="font-medium text-sm text-foreground">Generation Credits</h3>
              </div>
              <div className="flex-1 flex items-center justify-center opacity-50">
                <span className="text-sm italic">Loading usage API...</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm min-h-[160px] flex flex-col relative overflow-hidden">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Sparkles className="size-5 text-primary" />
                <h3 className="font-medium text-sm text-foreground">Active Classrooms</h3>
              </div>
              <div className="flex-1 flex items-center justify-center opacity-50">
                <span className="text-sm italic">Connecting limits...</span>
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
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                    <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                    <p>Awaiting Live Invoice API implementation</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </main>
    </div>
  );
}
