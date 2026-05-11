'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, Plus, Trash2 } from 'lucide-react';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Header } from '@/components/header';
import { UserMenu } from '@/components/layout/user-menu';
import { CreditsDisplay } from '@/components/layout/credits-display';
import { SettingsDialog } from '@/components/settings';
import { verifyAuthSession, hasAuthSessionHint, clearAuthSession } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';

export default function PaymentMethodsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (!hasAuthSessionHint()) { router.push('/auth?next=/billing/payment'); return; }
      try {
        const isValid = await verifyAuthSession();
        if (!isValid) { clearAuthSession(); router.push('/auth?next=/billing/payment'); return; }
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
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
        currentSceneTitle="Billing: Payment Methods" 
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
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Payment Methods</h1>
              <p className="text-sm text-neutral-500">Manage your saved credit cards and payment preferences.</p>
            </div>
            <Button className="gap-2">
              <Plus size={16} />
              Add Method
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-primary opacity-50" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm flex flex-col justify-between min-h-[180px] relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="text-red-500 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-start gap-4">
                  <div className="size-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <p className="font-bold text-neutral-900 dark:text-white">Visa ending in 4242</p>
                    <p className="text-xs text-neutral-500 font-medium">Expires 12/28</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 uppercase tracking-widest">Default</span>
                </div>
              </div>

              <button className="p-6 rounded-2xl border-2 border-dashed border-neutral-200 dark:border-neutral-800 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-3 text-neutral-400 hover:text-primary min-h-[180px]">
                <div className="size-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <Plus size={20} />
                </div>
                <p className="text-sm font-bold uppercase tracking-widest">Add New Card</p>
              </button>
            </div>
          )}
        </div>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </DashboardShell>
  );
}
