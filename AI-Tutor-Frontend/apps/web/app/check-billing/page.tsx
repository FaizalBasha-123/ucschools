'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { authHeaders, hasAuthSessionHint } from '@/lib/auth/session';

interface BillingStatus {
  creditBalance: number;
  hasActiveSubscription: boolean;
}

/**
 * BillingCheckPage - Post-login billing verification
 * 
 * Logic:
 * 1. Active plan + Credits > 0: redirect to /classroom ✓
 * 2. Active plan + Credits = 0: show popup "buy credits" ✓
 * 3. No plan + Credits = 0: redirect to /pricing ✓
 * 4. No plan + Credits > 0: show popup "buy plan" ✓
 */
export default function CheckBillingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'error' | 'modal-credits' | 'modal-plan'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkBilling = async () => {
      // Verify user is authenticated
      if (!hasAuthSessionHint()) {
        router.replace('/auth?mode=signin');
        return;
      }

      try {
        // Fetch billing dashboard with real API call
        // Optimized: Call the Rust backend directly if the public API URL is configured
        // otherwise fallback to the local Next.js proxy.
        const apiBase = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || '';
        const url = apiBase ? `${apiBase}/api/billing/dashboard` : '/api/billing/dashboard';

        const res = await fetch(url, {
          method: 'GET',
          headers: authHeaders(),
          cache: 'no-store',
        });

        if (!res.ok) {
          throw new Error(`Billing check failed: ${res.status}`);
        }

        const data = await res.json();
        
        // Extract real billing data
        const creditBalance = data.data?.entitlement?.credit_balance ?? 0;
        const hasActiveSubscription = data.data?.entitlement?.has_active_subscription ?? false;

        // MANDATORY: If no active subscription, always show pricing page on sign-in
        if (!hasActiveSubscription) {
          router.replace('/pricing');
          return;
        }

        // If has subscription but no credits, show top-up
        if (creditBalance <= 0) {
          setStatus('modal-credits');
        } else {
          // Has subscription and credits - proceed
          router.replace('/classroom');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to check billing status';
        setError(message);
        setStatus('error');
        toast.error('Billing check failed', { description: message });
      }
    };

    checkBilling();
  }, [router]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
      {status === 'loading' && (
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-neutral-600 dark:text-neutral-400">Checking your billing status...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-6 max-w-md text-center">
          <p className="text-red-800 dark:text-red-200 font-medium mb-4">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => router.replace('/pricing')}
              className="flex-1 px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              View Plans
            </button>
          </div>
        </div>
      )}

      {status === 'modal-credits' && (
        <CreditsPurchaseModal onClose={() => router.replace('/classroom')} />
      )}

      {status === 'modal-plan' && (
        <PlanPurchaseModal onClose={() => router.replace('/classroom')} />
      )}
    </div>
  );
}

/**
 * Modal for purchasing credits when user has plan but no credits
 */
function CreditsPurchaseModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 md:p-8 shadow-2xl animate-in fade-in scale-95 duration-300">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
              Top Up Your Credits
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              Your plan is active, but you've used all your credits. Purchase more to continue learning.
            </p>
          </div>

          {/* Credit options */}
          <div className="space-y-3">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-white">100 Credits</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">Most popular</p>
                </div>
                <p className="text-lg font-bold text-primary">₹999</p>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-white">250 Credits</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">Best value</p>
                </div>
                <p className="text-lg font-bold text-primary">₹2,499</p>
              </div>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-white">500 Credits</p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">Premium</p>
                </div>
                <p className="text-lg font-bold text-primary">₹4,999</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 font-medium transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                // TODO: Redirect to payment/checkout
                toast.info('Redirecting to checkout...');
              }}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 font-medium transition-colors"
            >
              Buy Credits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal for purchasing a plan when user has credits but no plan
 */
function PlanPurchaseModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 md:p-8 shadow-2xl animate-in fade-in scale-95 duration-300">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
              Choose Your Plan
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              You have credits available, but need an active plan to generate lessons. Choose a plan that fits your needs.
            </p>
          </div>

          {/* Plan options */}
          <div className="space-y-3">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-neutral-900 dark:text-white">Starter</p>
                <p className="text-lg font-bold text-primary">₹499/mo</p>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">100 credits/month</p>
            </div>

            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-colors ring-2 ring-emerald-300 dark:ring-emerald-800">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-white">Pro</p>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-200 dark:bg-emerald-800 px-2 py-0.5 rounded">Popular</span>
                </div>
                <p className="text-lg font-bold text-primary">₹999/mo</p>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">300 credits/month</p>
            </div>

            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-neutral-900 dark:text-white">Enterprise</p>
                <p className="text-lg font-bold text-primary">₹2,999/mo</p>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">1000 credits/month</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 font-medium transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                // TODO: Redirect to payment/checkout
                toast.info('Redirecting to checkout...');
              }}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 font-medium transition-colors"
            >
              Subscribe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
