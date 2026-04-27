'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users, Activity, CreditCard, ArrowUpRight, TrendingUp, Settings, Database, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { verifyAuthSession, hasAuthSessionHint, clearAuthSession } from '@/lib/auth/session';

const log = createLogger('AdminConsole');

export default function AdminPage() {
  const { t } = useI18n();
  const router = useRouter();
  
  const [authChecking, setAuthChecking] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [subscriptionStats, setSubscriptionStats] = useState<any>(null);
  const [paymentStats, setPaymentStats] = useState<any>(null);
  const [promoStats, setPromoStats] = useState<any>(null);

  useEffect(() => {
    const enforceAuth = async () => {
      setAuthChecking(true);
      try {
        await refreshAdminData();
      } catch (err) {
        log.error('Operator auth check failed', err);
        router.push('/operator');
      } finally {
        setAuthChecking(false);
      }
    };
    enforceAuth();
  }, [router]);

  const refreshAdminData = async () => {
    setDataLoading(true);
    setError(null);
    try {
      // Get bearer token from session storage if available
      const bearerToken = sessionStorage.getItem('adminBearerToken');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (bearerToken && bearerToken.trim()) {
        headers['Authorization'] = `Bearer ${bearerToken.trim()}`;
      }

      // Fetch admin overview (which aggregates all stats)
      const overviewRes = await fetch('/api/admin/overview', {
        headers,
        cache: 'no-store',
      });

      if (overviewRes.status === 401) {
        log.warn('Operator session expired or invalid');
        router.push('/operator');
        return;
      }

      if (overviewRes.status === 403) {
        log.warn('Access denied to admin panel - insufficient permissions');
        setError('You do not have permission to access the admin panel.');
        setDataLoading(false);
        return;
      }

      if (!overviewRes.ok) {
        throw new Error(`Overview fetch failed: ${overviewRes.status}`);
      }

      const overviewData = await overviewRes.json();
      
      // Update state with real data
      if (overviewData.success || overviewData.users) {
        setUserStats(overviewData.users || null);
        setSubscriptionStats(overviewData.subscriptions || null);
        setPaymentStats(overviewData.payments || null);
        setPromoStats(overviewData.promo_codes || null);
        setMessage('Admin data loaded successfully');
      } else {
        throw new Error('Invalid response format from admin overview');
      }
    } catch (err) {
      log.error('Failed to fetch admin data', err);
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setDataLoading(false);
    }
  };

  // If we are strictly checking auth, hide UI completely or show loading barrier
  if (authChecking) {
    return (
      <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-900/50 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex w-full min-h-screen bg-neutral-50 dark:bg-neutral-900/50">
      <EnterpriseSidebar onSignOut={async () => {
        try {
          await fetch('/api/operator/auth/logout', { method: 'POST' });
        } catch (e) {
          log.error('Failed to logout operator', e);
        }
        router.push('/operator');
      }} />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin Console</h1>
              <p className="text-sm text-muted-foreground mt-1">Platform overview, user management, and system health.</p>
            </div>
            
            <div className="flex items-center gap-3">
              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 px-3 py-2 bg-red-50 dark:bg-red-950 rounded">
                  {error}
                </div>
              )}
              {message && !error && (
                <div className="text-sm text-green-600 dark:text-green-400 px-3 py-2 bg-green-50 dark:bg-green-950 rounded">
                  {message}
                </div>
              )}
              <Button 
                variant="outline" 
                className="gap-2" 
                disabled={dataLoading}
                onClick={refreshAdminData}
              >
                <Database className="size-4" />
                {dataLoading ? 'Refreshing...' : 'Refresh Metrics'}
              </Button>
            </div>
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            {/* Total Users Card */}
            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col relative overflow-hidden min-h-[140px]">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Users className="size-5 text-primary" />
                <h3 className="font-medium text-sm text-foreground">Total Users</h3>
              </div>
              {userStats ? (
                <div>
                  <div className="text-3xl font-bold text-foreground">{userStats.total_users}</div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {userStats.new_users_today} new today
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-50">
                  {dataLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span className="text-sm italic">No data</span>
                  )}
                </div>
              )}
            </div>

            {/* Active Subscriptions Card */}
            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col relative overflow-hidden min-h-[140px]">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Activity className="size-5 text-blue-500" />
                <h3 className="font-medium text-sm text-foreground">Active Subscriptions</h3>
              </div>
              {subscriptionStats ? (
                <div>
                  <div className="text-3xl font-bold text-foreground">{subscriptionStats.active_subscriptions}</div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {subscriptionStats.churned_users_month} churned this month
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-50">
                  {dataLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span className="text-sm italic">No data</span>
                  )}
                </div>
              )}
            </div>

            {/* Monthly Revenue Card */}
            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col relative overflow-hidden min-h-[140px]">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <CreditCard className="size-5 text-emerald-500" />
                <h3 className="font-medium text-sm text-foreground">Monthly Revenue</h3>
              </div>
              {subscriptionStats ? (
                <div>
                  <div className="text-3xl font-bold text-foreground">
                    ${subscriptionStats.revenue_monthly.toFixed(2)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    ${subscriptionStats.revenue_rolling_30d.toFixed(2)} (30d rolling)
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-50">
                  {dataLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span className="text-sm italic">No data</span>
                  )}
                </div>
              )}
            </div>

            {/* Payment Success Rate Card */}
            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm flex flex-col relative overflow-hidden min-h-[140px]">
              <div className="flex items-center gap-3 text-muted-foreground mb-4">
                <Settings className="size-5 text-amber-500" />
                <h3 className="font-medium text-sm text-foreground">Payment Health</h3>
              </div>
              {paymentStats ? (
                <div>
                  <div className="text-3xl font-bold text-foreground">
                    {(paymentStats.success_rate * 100).toFixed(1)}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {paymentStats.successful_payments}/{paymentStats.total_payments} successful
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center opacity-50">
                  {dataLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span className="text-sm italic">No data</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-border/60 flex items-center justify-between">
                <h3 className="font-bold text-lg">Promo Code Performance</h3>
                <Button variant="ghost" size="sm" className="text-xs h-8" disabled={dataLoading}>View All</Button>
              </div>
              {promoStats ? (
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Codes</p>
                      <p className="text-2xl font-bold">{promoStats.active_promo_codes}/{promoStats.total_promo_codes}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Redemptions</p>
                      <p className="text-2xl font-bold">{promoStats.total_redemptions}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Credits Granted</p>
                      <p className="text-2xl font-bold">{promoStats.total_credits_granted.toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Utilization</p>
                      <p className="text-2xl font-bold">{(promoStats.average_redemption_rate * 100).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-12 text-center">
                  {dataLoading ? (
                    <>
                      <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                      <p className="text-muted-foreground">Loading promo code stats...</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No promo code data available</p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm">
              <h3 className="font-bold text-lg mb-6">System Status</h3>
              <div className="space-y-4">
                {userStats && subscriptionStats && paymentStats ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Data Updated</p>
                      <p className="text-sm font-medium">Just now</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Active Users (7d)</p>
                      <p className="text-sm font-medium">{userStats.active_users_week}</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Successful Payments</p>
                      <p className="text-sm font-medium">{paymentStats.successful_payments}</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">✓ Operational</p>
                    </div>
                  </>
                ) : (
                  <div className="px-4 py-12 text-center text-muted-foreground">
                    {dataLoading ? (
                      <>
                        <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                        <p className="text-sm">Loading system status...</p>
                      </>
                    ) : (
                      <p className="text-sm">No status data available</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
