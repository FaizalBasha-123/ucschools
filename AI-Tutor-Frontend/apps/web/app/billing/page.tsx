'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingPage');

interface BillingCatalogItem {
  product_code: string;
  kind: string;
  title: string;
  credits: number;
  currency: string;
  amount_minor: number;
}

interface BillingCatalogResponse {
  success: true;
  gateway: string;
  items: BillingCatalogItem[];
}

interface PaymentOrder {
  id: string;
  account_id: string;
  product_code: string;
  kind: string;
  gateway: string;
  status: string;
  amount_minor: number;
  currency: string;
  credits_to_grant: number;
  created_at: string;
}

interface PaymentOrdersResponse {
  success: true;
  orders: PaymentOrder[];
}

interface SubscriptionResponse {
  id: string;
  account_id: string;
  plan_code: string;
  status: string;
  billing_interval: string;
  credits_per_cycle: number;
  autopay_enabled: boolean;
  current_period_start: string;
  current_period_end: string;
  next_renewal_at?: string | null;
}

interface SubscriptionEnvelope {
  success: true;
  subscription: SubscriptionResponse | null;
}

interface BillingEntitlement {
  account_id: string;
  credit_balance: number;
  can_generate: boolean;
  has_active_subscription: boolean;
  active_subscription: SubscriptionResponse | null;
  blocking_unpaid_invoice_count: number;
  active_dunning_case_count: number;
}

interface BillingInvoiceSummary {
  id: string;
  invoice_type: string;
  status: string;
  amount_cents: number;
  amount_after_credits: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
  due_at?: string | null;
  paid_at?: string | null;
  created_at: string;
}

interface BillingDashboardEnvelope {
  success: true;
  entitlement: BillingEntitlement;
  recent_orders: PaymentOrder[];
  recent_ledger_entries: Array<{
    id: string;
    kind: string;
    amount: number;
    reason: string;
    created_at: string;
  }>;
  recent_invoices: BillingInvoiceSummary[];
}

interface ApiError {
  success: false;
  error: string;
  details?: string;
}

function asCurrency(amountMinor: number, currency: string): string {
  const amountMajor = amountMinor / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(amountMajor);
}

function authHeaders(token: string): HeadersInit {
  if (!token.trim()) {
    return {};
  }
  return {
    Authorization: `Bearer ${token.trim()}`,
  };
}

export default function BillingPage() {
  const { t } = useI18n();
  const [bearerToken, setBearerToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalogItem[]>([]);
  const [gateway, setGateway] = useState('easebuzz');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [entitlement, setEntitlement] = useState<BillingEntitlement | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoiceSummary[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoRedeemed, setPromoRedeemed] = useState(false);

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem('billingBearerToken');
      if (savedToken) {
        setBearerToken(savedToken);
      }
    } catch {
      // Ignore localStorage failures in restricted browser contexts.
    }
  }, []);

  const hasToken = useMemo(() => bearerToken.trim().length > 0, [bearerToken]);

  const refreshAll = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const headers = authHeaders(bearerToken);

      const [catalogRes, ordersRes, subscriptionRes, dashboardRes] = await Promise.all([
        fetch('/api/billing/catalog', { headers, cache: 'no-store' }),
        fetch('/api/billing/orders?limit=20', { headers, cache: 'no-store' }),
        fetch('/api/subscriptions/me', { headers, cache: 'no-store' }),
        fetch('/api/billing/dashboard', { headers, cache: 'no-store' }),
      ]);

      const catalogJson = (await catalogRes.json()) as BillingCatalogResponse | ApiError;
      if (!catalogRes.ok || !catalogJson.success) {
        throw new Error(catalogJson.success ? 'Failed to load billing catalog' : catalogJson.error);
      }
      setCatalog(catalogJson.items || []);
      setGateway(catalogJson.gateway || 'easebuzz');

      const ordersJson = (await ordersRes.json()) as PaymentOrdersResponse | ApiError;
      if (!ordersRes.ok || !ordersJson.success) {
        throw new Error(ordersJson.success ? 'Failed to load payment orders' : ordersJson.error);
      }
      setOrders(ordersJson.orders || []);

      const subscriptionJson = (await subscriptionRes.json()) as SubscriptionEnvelope | ApiError;
      if (!subscriptionRes.ok || !subscriptionJson.success) {
        throw new Error(
          subscriptionJson.success ? 'Failed to load subscription' : subscriptionJson.error,
        );
      }
      setSubscription(subscriptionJson.subscription || null);

      const dashboardJson = (await dashboardRes.json()) as BillingDashboardEnvelope | ApiError;
      if (!dashboardRes.ok || !dashboardJson.success) {
        throw new Error(
          dashboardJson.success ? 'Failed to load billing dashboard' : dashboardJson.error,
        );
      }
      setEntitlement(dashboardJson.entitlement || null);
      setInvoices(dashboardJson.recent_invoices || []);

      setMessage(t('billing.refreshSuccess'));
    } catch (err) {
      log.error('Failed to refresh billing page', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const createCheckout = async (productCode: string) => {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          ...authHeaders(bearerToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ product_code: productCode }),
      });
      const json = (await response.json()) as
        | {
            success: true;
            checkout_url?: string;
            authorization_url?: string;
          }
        | ApiError;

      if (!response.ok || !json.success) {
        throw new Error(json.success ? 'Checkout creation failed' : json.error);
      }

      const checkoutUrl = json.checkout_url || json.authorization_url;
      if (!checkoutUrl) {
        setMessage('Checkout session created. No redirect URL was returned.');
        return;
      }

      window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      setMessage('Checkout created. Opened payment page in a new tab.');
      await refreshAll();
    } catch (err) {
      log.error('Failed to create checkout', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveToken = () => {
    try {
      localStorage.setItem('billingBearerToken', bearerToken.trim());
      setMessage(t('billing.tokenSaved'));
      setError(null);
    } catch {
      setError(t('billing.tokenPersistError'));
    }
  };

  const clearToken = () => {
    setBearerToken('');
    try {
      localStorage.removeItem('billingBearerToken');
    } catch {
      // no-op
    }
  };

  const redeemPromoCode = async () => {
    setError(null);
    setMessage(null);
    if (!promoCode.trim()) {
      setError(t('billing.enterPromoCode'));
      return;
    }
    try {
      const response = await fetch('/api/credits/redeem', {
        method: 'POST',
        headers: {
          ...authHeaders(bearerToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: promoCode.trim() }),
      });
      const json = (await response.json()) as {
        success: boolean;
        message: string;
        credits_granted: number;
      };

      if (!response.ok || !json.success) {
        throw new Error(json.message || 'Redemption failed');
      }

      setMessage(json.message || t('billing.promoRedeemedSuccess'));
      setPromoCode('');
      setPromoRedeemed(true);
      await refreshAll();
    } catch (err) {
      log.error('Failed to redeem promo code', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('billing.title')}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {t('billing.subtitle')}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100"
          >
            {t('billing.backToClassroom')}
          </Link>
        </div>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('billing.authTitle')}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {t('billing.authDescription')}
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input
              type="password"
              placeholder={t('billing.tokenPlaceholder')}
              value={bearerToken}
              onChange={(event) => setBearerToken(event.target.value)}
              className="sm:flex-1"
            />
            <Button onClick={saveToken} type="button">
              {t('billing.saveToken')}
            </Button>
            <Button onClick={clearToken} type="button" variant="outline">
              {t('billing.clearToken')}
            </Button>
            <Button onClick={refreshAll} type="button" disabled={loading || !hasToken}>
              {loading ? t('billing.refreshing') : t('billing.refreshData')}
            </Button>
          </div>
          {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">{t('billing.catalogTitle')} ({gateway})</h2>
            {catalog.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">{t('billing.catalogEmpty')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {catalog.map((item) => (
                  <li
                    key={item.product_code}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-slate-600">
                        {item.product_code} • {item.kind} • {item.credits} credits
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {asCurrency(item.amount_minor, item.currency)}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!hasToken}
                        onClick={() => createCheckout(item.product_code)}
                      >
                        {t('billing.checkout')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">{t('billing.redeemTitle')}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t('billing.redeemDescription')}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="text"
                  placeholder={t('billing.promoPlaceholder')}
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                  className="sm:flex-1"
                  disabled={!hasToken}
                />
                <Button
                  onClick={redeemPromoCode}
                  type="button"
                  disabled={loading || !hasToken || !promoCode.trim()}
                >
                  {loading ? t('billing.redeeming') : t('billing.redeem')}
                </Button>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('billing.currentSubscription')}</h2>
          {!subscription ? (
            <p className="mt-3 text-sm text-slate-600">{t('billing.noSubscription')}</p>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                <span className="font-medium">Plan:</span> {subscription.plan_code}
              </p>
              <p>
                <span className="font-medium">Status:</span> {subscription.status}
              </p>
              <p>
                <span className="font-medium">Interval:</span> {subscription.billing_interval}
              </p>
              <p>
                <span className="font-medium">Credits/cycle:</span> {subscription.credits_per_cycle}
              </p>
              <p>
                <span className="font-medium">Current period end:</span>{' '}
                {new Date(subscription.current_period_end).toLocaleString()}
              </p>
            </div>
          )}
        </section>

        {promoRedeemed && (
          <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-800">
              {t('billing.promoRedeemedBanner')}
            </p>
          </section>
        )}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Entitlement Status</h2>
          {!entitlement ? (
            <p className="mt-3 text-sm text-slate-600">No entitlement data loaded yet.</p>
          ) : (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="font-medium">Can generate:</span>{' '}
                {entitlement.can_generate ? 'Yes' : 'No'}
              </p>
              <p>
                <span className="font-medium">Credit balance:</span>{' '}
                {entitlement.credit_balance.toFixed(2)}
              </p>
              <p>
                <span className="font-medium">Active subscription:</span>{' '}
                {entitlement.has_active_subscription ? 'Yes' : 'No'}
              </p>
              <p>
                <span className="font-medium">Blocking unpaid invoices:</span>{' '}
                {entitlement.blocking_unpaid_invoice_count}
              </p>
              <p>
                <span className="font-medium">Active dunning cases:</span>{' '}
                {entitlement.active_dunning_case_count}
              </p>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('billing.recentOrders')}</h2>
          {orders.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">{t('billing.ordersEmpty')}</p>
          ) : (
            <>
            <div className="mt-3 space-y-2 sm:hidden">
              {orders.map((order) => (
                <div key={order.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-mono text-xs text-slate-500">{order.id}</p>
                  <p className="mt-1 font-medium">{order.product_code}</p>
                  <p className="text-slate-600">{order.status}</p>
                  <p className="text-slate-900">{asCurrency(order.amount_minor, order.currency)}</p>
                  <p className="text-xs text-slate-500">{new Date(order.created_at).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Order</th>
                    <th className="px-2 py-2">Product</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Amount</th>
                    <th className="px-2 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-mono text-xs">{order.id}</td>
                      <td className="px-2 py-2">{order.product_code}</td>
                      <td className="px-2 py-2">{order.status}</td>
                      <td className="px-2 py-2">
                        {asCurrency(order.amount_minor, order.currency)}
                      </td>
                      <td className="px-2 py-2">{new Date(order.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">{t('billing.recentInvoices')}</h2>
          {invoices.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">{t('billing.invoicesEmpty')}</p>
          ) : (
            <>
            <div className="mt-3 space-y-2 sm:hidden">
              {invoices.map((invoice) => (
                <div key={invoice.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-mono text-xs text-slate-500">{invoice.id}</p>
                  <p className="mt-1">{invoice.invoice_type} • {invoice.status}</p>
                  <p>{(invoice.amount_after_credits / 100).toFixed(2)}</p>
                  <p className="text-xs text-slate-500">
                    {invoice.due_at ? new Date(invoice.due_at).toLocaleString() : '-'}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 hidden overflow-x-auto sm:block">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-2 py-2">Invoice</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Amount</th>
                    <th className="px-2 py-2">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-mono text-xs">{invoice.id}</td>
                      <td className="px-2 py-2">{invoice.invoice_type}</td>
                      <td className="px-2 py-2">{invoice.status}</td>
                      <td className="px-2 py-2">{(invoice.amount_after_credits / 100).toFixed(2)}</td>
                      <td className="px-2 py-2">
                        {invoice.due_at ? new Date(invoice.due_at).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
