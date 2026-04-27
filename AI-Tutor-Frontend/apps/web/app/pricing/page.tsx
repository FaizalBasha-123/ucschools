'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { Check, Info, Minus, Plus, Zap, Sparkles, Layers } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/layout/site-header';
import { authHeaders, hasAuthSessionHint } from '@/lib/auth/session';

type BillingMode = 'monthly' | 'annual';

type PlanDefinition = {
  id: string;
  name: string;
  description: string;
  monthlyOriginal: number;
  monthlyCurrent: number;
  annualOriginal: number;
  annualCurrent: number;
  monthlyCredits: number;
  features: string[];
  ctaLabel: string;
  highlighted?: boolean;
};

const planDefinitions: PlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for students and casual learners exploring AI generation.',
    monthlyOriginal: 2,
    monthlyCurrent: 1,
    annualOriginal: 12,
    annualCurrent: 10,
    monthlyCredits: 10,
    ctaLabel: 'Get Starter',
    features: ['Standard generation speed', 'Basic classroom templates', 'Community support'],
  },
  {
    id: 'plus',
    name: 'Plus',
    description: 'The ideal plan for teachers requiring consistent daily lessons.',
    monthlyOriginal: 7,
    monthlyCurrent: 5,
    annualOriginal: 60,
    annualCurrent: 48,
    monthlyCredits: 30,
    ctaLabel: 'Get Plus',
    highlighted: true,
    features: [
      'Fast generation priority',
      'Advanced interactive elements',
      'Unlimited active classrooms',
      'Premium email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Maximum power and priority for schools and power users.',
    monthlyOriginal: 16,
    monthlyCurrent: 12,
    annualOriginal: 144,
    annualCurrent: 108,
    monthlyCredits: 80,
    ctaLabel: 'Get Pro',
    features: ['Absolute highest priority queue', 'Early access to new models', 'Dedicated account manager'],
  },
];

function formatMoney(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    const start = previousValue.current;
    const end = value;
    const durationMs = 420;
    const startedAt = performance.now();
    let frameId = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = start + (end - start) * eased;
      setDisplayValue(next);
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    previousValue.current = end;

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [value]);

  return <>{displayValue.toFixed(decimals)}</>;
}

function PricingPageContent() {
  const router = useRouter();
  const [billingMode, setBillingMode] = useState<BillingMode>('monthly');
  const [customCredits, setCustomCredits] = useState(10);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number>(0);
  const [billingLoading, setBillingLoading] = useState(true);
  const creditPrice = 0.5;

  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
...
  useEffect(() => {
    async function loadBilling() {
      if (!hasAuthSessionHint()) {
        setBillingLoading(false);
        return;
      }
      try {
        const res = await fetch('/api/billing/dashboard', {
          method: 'GET',
          headers: authHeaders(),
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setCreditBalance(data.data?.entitlement?.credit_balance ?? 0);
        }
      } catch (err) {
        console.error('Failed to load billing for pricing page:', err);
      } finally {
        setBillingLoading(false);
      }
    }
    loadBilling();
  }, []);
  const [enterpriseForm, setEnterpriseForm] = useState({
    school_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    message: ''
  });
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [enterpriseSuccess, setEnterpriseSuccess] = useState(false);
  const [enterpriseError, setEnterpriseError] = useState<string | null>(null);

  const handleEnterpriseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnterpriseError(null);
    setEnterpriseLoading(true);

    try {
      const res = await fetch('/api/public/contact-enterprise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enterpriseForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit request');
      setEnterpriseSuccess(true);
    } catch (err: any) {
      setEnterpriseError(err.message);
    } finally {
      setEnterpriseLoading(false);
    }
  };

  const handleCheckout = (planId: string) => {
    // Route to auth before billing checkout flow.
    router.push('/auth?next=/billing');
  };

  const openPromoModal = () => {
    setPromoError(null);
    setPromoMessage(null);
    setPromoOpen(true);
  };

  const redeemPromoCode = async () => {
    const normalizedCode = promoCode.trim().toUpperCase();
    setPromoError(null);
    setPromoMessage(null);

    if (!normalizedCode) {
      setPromoError('Please enter a promo code.');
      return;
    }

    if (!hasAuthSessionHint()) {
      setPromoOpen(false);
      router.push('/auth?next=/pricing');
      return;
    }

    setPromoLoading(true);
    try {
      const response = await fetch('/api/credits/redeem', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ code: normalizedCode }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        credits_granted?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || payload.message || 'Unable to redeem promo code right now.');
      }

      if (!payload.success) {
        throw new Error(payload.message || 'Promo code redemption failed.');
      }

      setPromoMessage(payload.message || 'Promo code redeemed successfully.');
      setPromoCode('');
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 font-sans text-neutral-900 pb-24">
      <SiteHeader variant="pricing" />

      {promoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-neutral-900">Redeem Promo Code</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Enter your promo code to claim bonus credits. Validation is enforced server-side per account.
              </p>
            </div>

            <div className="space-y-3">
              <input
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                placeholder="Promo code (e.g., FREEBYUCS)"
                className="h-11 w-full rounded-xl border border-neutral-200 px-3 text-sm font-medium uppercase tracking-wide text-neutral-900 outline-none focus:border-neutral-400"
              />

              {promoError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{promoError}</div>
              ) : null}

              {promoMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {promoMessage}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPromoOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={redeemPromoCode}
                disabled={promoLoading || !promoCode.trim()}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {promoLoading ? 'Redeeming...' : 'Redeem'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Hero Section */}
      <section className="pt-16 pb-12 px-4 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-neutral-900 mb-6">
          Invest in your workflow.
        </h1>
        <p className="text-lg text-neutral-500 max-w-2xl mx-auto">
          Choose the perfect plan for your classroom generation needs. Upgrade, downgrade, or buy individual credits whenever you want.
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setBillingMode('monthly')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              billingMode === 'monthly'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
            }`}
          >
            Monthly billing
          </button>
          <button
            type="button"
            onClick={() => setBillingMode('annual')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              billingMode === 'annual'
                ? 'bg-neutral-900 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
            }`}
          >
            Annual billing
          </button>
        </div>
      </section>

      {/* Subscription Plans */}
      <div className="max-w-7xl mx-auto px-4 mt-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {planDefinitions.map((plan) => {
            const isAnnual = billingMode === 'annual';
            const activePrice = isAnnual ? plan.annualCurrent : plan.monthlyCurrent;
            const crossedPrice = isAnnual ? plan.annualOriginal : plan.monthlyOriginal;
            const savePercent = Math.round(((crossedPrice - activePrice) / crossedPrice) * 100);
            const activeCredits = isAnnual ? plan.monthlyCredits * 12 : plan.monthlyCredits;

            return (
              <div
                key={plan.id}
                className={`rounded-3xl bg-white p-8 transition-all hover:shadow-md ${
                  plan.highlighted
                    ? 'relative z-10 border-2 border-[#1ed760] shadow-xl md:scale-105 hover:shadow-2xl'
                    : 'border border-neutral-200 shadow-sm'
                }`}
              >
                {plan.highlighted ? (
                  <div className="absolute top-0 left-1/2 -tranneutral-x-1/2 -tranneutral-y-1/2 rounded-full bg-[#1ed760] px-3 py-1 text-xs font-bold uppercase tracking-widest text-white shadow-sm">
                    Most Popular
                  </div>
                ) : null}

                <div className={`mb-6 ${plan.highlighted ? 'mt-2' : ''}`}>
                  <h3 className="flex items-center gap-2 text-xl font-bold text-neutral-900">
                    {plan.name === 'Plus' ? <Sparkles className="h-5 w-5 text-[#1ed760]" /> : null}
                    {plan.name}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-500">{plan.description}</p>
                </div>

                <div className="mb-6">
                  <div className="mb-2 flex items-end gap-2">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
                      Save {savePercent}%
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-neutral-900">
                      $<AnimatedNumber value={activePrice} decimals={Number.isInteger(activePrice) ? 0 : 2} />
                    </span>
                    <span className="text-neutral-500 font-medium">
                      {isAnnual ? '/year' : '/month'}
                    </span>
                    <span className="relative inline-flex items-center text-4xl font-extrabold text-neutral-600">
                      $<AnimatedNumber value={crossedPrice} decimals={Number.isInteger(crossedPrice) ? 0 : 2} />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0 right-0 top-1/2 h-[2px] -tranneutral-y-1/2 -rotate-[22deg] bg-neutral-600"
                      />
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-neutral-600">
                    <span className="font-semibold text-neutral-900">
                      <AnimatedNumber value={activeCredits} decimals={0} />
                    </span>{' '}
                    credits {isAnnual ? 'per year' : 'per month'}
                  </p>
                </div>

                <button
                  onClick={() => handleCheckout(`${plan.id}_${billingMode}`)}
                  className={`mb-8 w-full rounded-xl px-4 py-3 font-semibold transition-colors ${
                    plan.highlighted
                      ? 'bg-[#1ed760] text-white shadow-[0_0_15px_rgba(30,215,96,0.2)] hover:bg-[#1fdf64]'
                      : plan.name === 'Pro'
                        ? 'bg-neutral-900 text-white hover:bg-neutral-800'
                        : 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200'
                  }`}
                >
                  {plan.ctaLabel}
                </button>

                <div className="space-y-4">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#1ed760]" />
                      <span className="text-sm text-neutral-600">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-3xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-8 shadow-sm">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Schools & Colleges</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">Enterprise Classroom Plan</h3>
              <p className="mt-3 text-neutral-600">
                A clean institutional package for district-wide deployments with centralized governance, procurement-friendly billing, and onboarding support.
              </p>
            </div>

            <div className="group relative w-full lg:w-auto">
              <button
                type="button"
                onClick={() => {
                  setEnterpriseSuccess(false);
                  setEnterpriseForm({ school_name: '', contact_name: '', contact_email: '', contact_phone: '', message: '' });
                  setEnterpriseOpen(true);
                }}
                className="w-full rounded-xl bg-neutral-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 lg:w-auto"
              >
                Contact Us
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 text-sm text-neutral-700 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">Centralized admin controls</div>
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">Custom annual invoicing</div>
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">LMS and SSO alignment</div>
            <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">Priority onboarding support</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto mt-24 px-4">
        <h2 className="text-3xl font-bold text-center text-neutral-900 mb-2">Need more power?</h2>
        <p className="text-center text-neutral-500 mb-12">Buy additional credits instantly. No subscription required.</p>
        
        {/* Infinite Top-ups Module */}
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 md:p-12 shadow-sm mb-8 overflow-hidden relative">
          {/* Decorative background element */}
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#1ed760]/10 blur-3xl pointer-events-none" />
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-12 relative z-10">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-6 w-6 text-[#1ed760]" />
                <h3 className="text-2xl font-bold text-neutral-900">Infinite Top-ups</h3>
              </div>
              <p className="text-neutral-500 mb-8 max-w-sm">
                Buy exactly the amount of credits you need. They never expire and cost exactly $0.50 each.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-2xl bg-neutral-50 border border-neutral-100">
                <div className="flex items-center bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
                  <button 
                    onClick={() => setCustomCredits(Math.max(1, customCredits - 1))}
                    className="p-3 hover:bg-neutral-50 text-neutral-500 transition-colors"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <input 
                    type="number" 
                    value={customCredits}
                    onChange={(e) => setCustomCredits(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 text-center font-bold text-lg text-neutral-900 outline-none border-x border-neutral-200 py-2 bg-transparent"
                  />
                  <button 
                    onClick={() => setCustomCredits(customCredits + 1)}
                    className="p-3 hover:bg-neutral-50 text-neutral-500 transition-colors"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-neutral-400 uppercase tracking-widest bg-white px-2 rounded-t-md">Total Price</span>
                  <span className="text-3xl font-extrabold text-neutral-900">
                    ${(customCredits * creditPrice).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="w-full md:w-auto shrink-0 mt-4 md:mt-0">
              <button 
                onClick={() => handleCheckout(`credits_${customCredits}`)}
                className="w-full md:w-48 py-4 px-6 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold rounded-2xl transition-colors shadow-xl shadow-neutral-900/10 flex items-center justify-center gap-2"
              >
                Buy Now
              </button>
            </div>
          </div>
        </div>

        {/* Preset Bundles Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm flex items-center justify-between transition-all hover:border-[#1ed760]/30 hover:shadow-md cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-neutral-900 text-lg">Small Bundle</h4>
                <p className="text-sm font-medium text-[#1ed760]">$5.00 • 10 credits</p>
              </div>
            </div>
            <button className="px-5 py-2.5 text-sm font-semibold text-neutral-700 bg-neutral-100 rounded-xl hover:bg-neutral-200 transition-colors">
              Add
            </button>
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm flex items-center justify-between transition-all hover:border-[#1ed760]/30 hover:shadow-md cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 text-[#1ed760]">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-bold text-neutral-900 text-lg">Large Bundle</h4>
                <p className="text-sm font-medium text-[#1ed760]">$32.50 • 65 credits</p>
              </div>
            </div>
            <button className="px-5 py-2.5 text-sm font-semibold text-white bg-neutral-900 rounded-xl hover:bg-neutral-800 transition-colors">
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Enterprise Modal */}
      {enterpriseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl relative overflow-hidden">
            {enterpriseLoading && (
              <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900"></div>
              </div>
            )}
            <h3 className="text-2xl font-bold text-neutral-900 mb-2">Enterprise Plan</h3>
            <p className="text-neutral-500 mb-6 text-sm">Tell us about your school or district needs and we'll be in touch shortly.</p>
            
            {enterpriseSuccess ? (
              <div className="bg-[#1ed760]/10 text-[#1ed760] px-4 py-6 rounded-xl text-center mb-6">
                <Check className="h-8 w-8 mx-auto mb-2" />
                <p className="font-medium">Request received!</p>
                <p className="text-sm opacity-90">We will contact you soon.</p>
              </div>
            ) : (
              <form onSubmit={handleEnterpriseSubmit} className="space-y-4">
                {enterpriseError && (
                  <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-4">
                    {enterpriseError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">School/District Name</label>
                    <input 
                      required
                      type="text" 
                      value={enterpriseForm.school_name}
                      onChange={e => setEnterpriseForm({...enterpriseForm, school_name: e.target.value})}
                      className="w-full rounded-xl border border-neutral-200 px-4 py-2 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1">Contact Name</label>
                    <input 
                      required
                      type="text" 
                      value={enterpriseForm.contact_name}
                      onChange={e => setEnterpriseForm({...enterpriseForm, contact_name: e.target.value})}
                      className="w-full rounded-xl border border-neutral-200 px-4 py-2 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Work Email</label>
                  <input 
                    required
                    type="email" 
                    value={enterpriseForm.contact_email}
                    onChange={e => setEnterpriseForm({...enterpriseForm, contact_email: e.target.value})}
                    className="w-full rounded-xl border border-neutral-200 px-4 py-2 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    value={enterpriseForm.contact_phone}
                    onChange={e => setEnterpriseForm({...enterpriseForm, contact_phone: e.target.value})}
                    className="w-full rounded-xl border border-neutral-200 px-4 py-2 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Message</label>
                  <textarea 
                    required
                    rows={3}
                    value={enterpriseForm.message}
                    onChange={e => setEnterpriseForm({...enterpriseForm, message: e.target.value})}
                    className="w-full rounded-xl border border-neutral-200 px-4 py-2 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 resize-none"
                    placeholder="Tell us about your deployment goals..."
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEnterpriseOpen(false)}
                    className="px-5 py-2.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 transition-colors"
                  >
                    Send Request
                  </button>
                </div>
              </form>
            )}
            
            {enterpriseSuccess && (
              <div className="flex justify-end pt-4 border-t border-neutral-100">
                <button
                  onClick={() => setEnterpriseOpen(false)}
                  className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-neutral-50" />}>
      <PricingPageContent />
    </Suspense>
  );
}
