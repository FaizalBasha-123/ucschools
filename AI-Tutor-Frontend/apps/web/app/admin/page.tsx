'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminConsole');

interface AdminUserStats {
  total_users: number;
  active_users_today: number;
  active_users_week: number;
  active_users_month: number;
  new_users_today: number;
  new_users_week: number;
}

interface AdminSubscriptionStats {
  total_subscriptions: number;
  active_subscriptions: number;
  cancelled_subscriptions: number;
  churned_users_month: number;
  revenue_monthly: number;
  revenue_rolling_30d: number;
}

interface AdminPaymentStats {
  total_payments: number;
  successful_payments: number;
  failed_payments: number;
  success_rate: number;
  total_revenue: number;
  average_transaction_value: number;
}

interface AdminPromoCodeStats {
  total_promo_codes: number;
  active_promo_codes: number;
  total_redemptions: number;
  total_credits_granted: number;
  average_redemption_rate: number;
}

interface ApiError {
  success: false;
  error: string;
  details?: string;
}

interface AdminOverviewEnvelope {
  success: true;
  users: AdminUserStats;
  subscriptions: AdminSubscriptionStats;
  payments: AdminPaymentStats;
  promo_codes: AdminPromoCodeStats;
}

interface SystemStatusEnvelope {
  success: true;
  status: string;
  runtime_alert_level: string;
  runtime_alerts: string[];
}

function authHeaders(token: string): HeadersInit {
  if (!token.trim()) {
    return {};
  }
  return {
    Authorization: `Bearer ${token.trim()}`,
  };
}

export default function AdminConsole() {
  const { t } = useI18n();
  const [bearerToken, setBearerToken] = useState('');
  const [operatorEmail, setOperatorEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userStats, setUserStats] = useState<AdminUserStats | null>(null);
  const [subscriptionStats, setSubscriptionStats] = useState<AdminSubscriptionStats | null>(null);
  const [paymentStats, setPaymentStats] = useState<AdminPaymentStats | null>(null);
  const [promoStats, setPromoStats] = useState<AdminPromoCodeStats | null>(null);
  const [runtimeAlertLevel, setRuntimeAlertLevel] = useState<string>('unknown');
  const [runtimeAlerts, setRuntimeAlerts] = useState<string[]>([]);

  useEffect(() => {
    try {
      const savedToken = sessionStorage.getItem('adminBearerToken');
      if (savedToken) {
        setBearerToken(savedToken);
      }
    } catch {
      // Ignore browser storage failures in restricted contexts.
    }
  }, []);

  const hasToken = useMemo(() => bearerToken.trim().length > 0, [bearerToken]);
  const canRefresh = hasToken || otpVerified;

  const refreshStats = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const headers = hasToken ? authHeaders(bearerToken) : {};

      const overviewRes = await fetch('/api/admin/overview', { headers, cache: 'no-store' });
      const overviewJson = (await overviewRes.json()) as AdminOverviewEnvelope | ApiError;

      if (!overviewRes.ok || (typeof overviewJson === 'object' && 'error' in overviewJson)) {
        throw new Error(
          typeof overviewJson === 'object' && 'error' in overviewJson
            ? overviewJson.error
            : 'Failed to load admin overview',
        );
      }

      setUserStats(overviewJson.users);
      setSubscriptionStats(overviewJson.subscriptions);
      setPaymentStats(overviewJson.payments);
      setPromoStats(overviewJson.promo_codes);

      const statusRes = await fetch('/api/system/status', { headers, cache: 'no-store' });
      const statusJson = (await statusRes.json()) as SystemStatusEnvelope | ApiError;
      if (!statusRes.ok || (typeof statusJson === 'object' && 'error' in statusJson)) {
        throw new Error(
          typeof statusJson === 'object' && 'error' in statusJson
            ? statusJson.error
            : 'Failed to load runtime system status',
        );
      }

      setRuntimeAlertLevel(statusJson.runtime_alert_level || 'unknown');
      setRuntimeAlerts(Array.isArray(statusJson.runtime_alerts) ? statusJson.runtime_alerts : []);

      setMessage(t('admin.refreshSuccess'));
    } catch (err) {
      log.error('Failed to refresh admin stats', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const saveToken = () => {
    try {
      sessionStorage.setItem('adminBearerToken', bearerToken.trim());
      setMessage(t('admin.tokenSaved'));
      setError(null);
    } catch {
      setError(t('admin.tokenPersistError'));
    }
  };

  const clearToken = () => {
    setBearerToken('');
    try {
      sessionStorage.removeItem('adminBearerToken');
    } catch {
      // no-op
    }
  };

  const requestOtp = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/operator/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: operatorEmail.trim() }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Failed to request OTP');
      }

      setOtpSent(true);
      setMessage('OTP sent to your operator email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/operator/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: operatorEmail.trim(),
          otp_code: otpCode.trim(),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Failed to verify OTP');
      }

      setOtpVerified(true);
      setMessage('Operator OTP verified. You can now refresh metrics.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const logoutOtpSession = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/operator/auth/logout', {
        method: 'POST',
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Failed to logout operator session');
      }

      setOtpVerified(false);
      setOtpSent(false);
      setOtpCode('');
      setMessage('Operator session logged out.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('admin.title')}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {t('admin.subtitle')}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
          >
            {t('admin.backToClassroom')}
          </Link>
        </div>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('admin.authTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t('admin.authDescription')}
          </p>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operator OTP Session</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Input
                type="email"
                placeholder="operator@company.com"
                value={operatorEmail}
                onChange={(event) => setOperatorEmail(event.target.value)}
              />
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit OTP"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={requestOtp} type="button" disabled={loading || !operatorEmail.trim()}>
                  Send OTP
                </Button>
                <Button
                  onClick={verifyOtp}
                  type="button"
                  variant="outline"
                  disabled={loading || !operatorEmail.trim() || otpCode.trim().length !== 6}
                >
                  Verify
                </Button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <span>Status:</span>
              <span className={otpVerified ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                {otpVerified ? 'Verified' : otpSent ? 'OTP sent' : 'Not authenticated'}
              </span>
              {otpVerified ? (
                <Button type="button" size="sm" variant="ghost" onClick={logoutOtpSession} disabled={loading}>
                  Logout OTP Session
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input
              type="password"
              placeholder={t('admin.tokenPlaceholder')}
              value={bearerToken}
              onChange={(event) => setBearerToken(event.target.value)}
              className="sm:flex-1"
            />
            <Button onClick={saveToken} type="button">
              {t('admin.saveToken')}
            </Button>
            <Button onClick={clearToken} type="button" variant="outline">
              {t('admin.clearToken')}
            </Button>
            <Button onClick={refreshStats} type="button" disabled={loading || !canRefresh}>
              {loading ? t('admin.refreshing') : t('admin.refreshMetrics')}
            </Button>
          </div>
          {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Runtime Alerts</h2>
          <p className="mt-1 text-sm text-slate-600">Current backend risk and readiness signals from /api/system/status.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Level:</span>
            <span
              className={
                runtimeAlertLevel === 'ok'
                  ? 'rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800'
                  : runtimeAlertLevel === 'degraded'
                    ? 'rounded bg-rose-100 px-2 py-0.5 font-medium text-rose-800'
                    : 'rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800'
              }
            >
              {runtimeAlertLevel}
            </span>
          </div>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {runtimeAlerts.length === 0 ? (
              <li className="text-emerald-700">No runtime alerts reported.</li>
            ) : (
              runtimeAlerts.map((alert) => (
                <li key={alert} className="rounded bg-slate-50 px-2 py-1">
                  {alert}
                </li>
              ))
            )}
          </ul>
        </section>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-600">{t('admin.totalUsers')}</h3>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {userStats?.total_users ?? '-'}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t('admin.totalUsersHint')}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-600">{t('admin.activeToday')}</h3>
            <p className="mt-2 text-3xl font-bold text-emerald-600">
              {userStats?.active_users_today ?? '-'}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t('admin.activeTodayHint')}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-600">{t('admin.activeWeek')}</h3>
            <p className="mt-2 text-3xl font-bold text-blue-600">
              {userStats?.active_users_week ?? '-'}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t('admin.activeWeekHint')}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-600">{t('admin.newToday')}</h3>
            <p className="mt-2 text-3xl font-bold text-purple-600">
              {userStats?.new_users_today ?? '-'}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t('admin.newTodayHint')}</p>
          </section>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">{t('admin.subscriptions')}</h2>
            {!subscriptionStats ? (
              <p className="mt-3 text-sm text-slate-600">{t('admin.noSubscriptionData')}</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Total Subscriptions</span>
                  <span className="font-semibold text-slate-900">
                    {subscriptionStats.total_subscriptions}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Active Subscriptions</span>
                  <span className="font-semibold text-emerald-600">
                    {subscriptionStats.active_subscriptions}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Cancelled</span>
                  <span className="font-semibold text-slate-900">
                    {subscriptionStats.cancelled_subscriptions}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Monthly Churn Rate</span>
                  <span className="font-semibold text-rose-600">
                    {subscriptionStats.churned_users_month} users
                  </span>
                </div>
                <div className="flex justify-between pt-2">
                  <span className="text-sm font-medium text-slate-600">Calendar Month Revenue</span>
                  <span className="text-lg font-bold text-slate-900">
                    ₹{subscriptionStats.revenue_monthly.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2">
                  <span className="text-sm font-medium text-slate-600">Rolling 30-Day Trend</span>
                  <span className="text-sm font-semibold text-slate-700">
                    ₹{subscriptionStats.revenue_rolling_30d.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">{t('admin.payments')}</h2>
            {!paymentStats ? (
              <p className="mt-3 text-sm text-slate-600">{t('admin.noPaymentData')}</p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Total Payments</span>
                  <span className="font-semibold text-slate-900">{paymentStats.total_payments}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Successful</span>
                  <span className="font-semibold text-emerald-600">
                    {paymentStats.successful_payments}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Failed</span>
                  <span className="font-semibold text-rose-600">{paymentStats.failed_payments}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-600">Success Rate</span>
                  <span className="font-semibold text-slate-900">
                    {(paymentStats.success_rate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between pt-2">
                  <span className="text-sm font-medium text-slate-600">Total Revenue</span>
                  <span className="text-lg font-bold text-slate-900">
                    ₹{paymentStats.total_revenue.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('admin.promoStats')}</h2>
          {!promoStats ? (
            <p className="mt-3 text-sm text-slate-600">{t('admin.noPromoData')}</p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Total Codes</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {promoStats.total_promo_codes}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Active Codes</p>
                <p className="mt-2 text-2xl font-bold text-emerald-600">
                  {promoStats.active_promo_codes}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Total Redemptions</p>
                <p className="mt-2 text-2xl font-bold text-blue-600">
                  {promoStats.total_redemptions}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Credits Granted</p>
                <p className="mt-2 text-2xl font-bold text-purple-600">
                  {promoStats.total_credits_granted.toFixed(0)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium text-slate-600">Avg Redemption</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {(promoStats.average_redemption_rate * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
