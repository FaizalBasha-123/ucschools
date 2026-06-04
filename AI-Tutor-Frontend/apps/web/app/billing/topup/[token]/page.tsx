'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Zap, AlertCircle, CreditCard } from 'lucide-react';

interface TopupInfo {
  valid: boolean;
  credits?: number;
  price_minor?: number;
  reason?: string;
  reason_error?: string;
}

export default function TopupPage() {
  const params = useParams();
  const token = params?.token as string;

  const [info, setInfo] = useState<TopupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`/api/billing/topup/validate?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        setInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setInfo({ valid: false, reason_error: 'Failed to validate link.' });
        setLoading(false);
      });
  }, [token]);

  const handlePay = async () => {
    if (!email.trim()) {
      setError('Please enter your email to continue.');
      return;
    }
    setCheckoutLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/topup/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!info?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-neutral-900 rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="size-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">Link Expired</h1>
          <p className="text-neutral-500 mb-6">
            {info?.reason_error || 'This payment link has expired or is invalid. Please contact your administrator for a new link.'}
          </p>
          <p className="text-sm text-neutral-400">Links expire after 10 minutes for security.</p>
        </div>
      </div>
    );
  }

  const priceInr = (info.price_minor ?? 0) / 100;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="size-6" />
              <h1 className="text-xl font-bold">Credit Top-Up</h1>
            </div>
            <p className="text-emerald-100 text-sm">Sent by your AI-Tutor administrator</p>
          </div>

          {/* Details */}
          <div className="p-6">
            <div className="space-y-4 mb-6">
              <div className="flex justify-between items-center py-3 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-neutral-500">Credits to Add</span>
                <span className="font-bold text-emerald-600 text-lg">
                  <Zap className="size-4 inline mr-1" />
                  {info.credits?.toFixed(1)} credits
                </span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-neutral-500">Amount</span>
                <span className="font-bold text-neutral-900 dark:text-white text-lg">
                  ₹{priceInr.toFixed(2)}
                </span>
              </div>
              {info.reason && (
                <div className="flex justify-between items-start py-3">
                  <span className="text-neutral-500">Reason</span>
                  <span className="text-neutral-700 dark:text-neutral-300 text-right max-w-[200px]">
                    {info.reason}
                  </span>
                </div>
              )}
            </div>

            {/* Email input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                Your Email (for payment confirmation)
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={checkoutLoading}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Redirecting to payment...
                </>
              ) : (
                <>
                  <CreditCard className="size-5" />
                  Pay ₹{priceInr.toFixed(2)} &amp; Add Credits
                </>
              )}
            </button>

            <p className="text-center text-xs text-neutral-400 mt-4">
              Secured by AI-Tutor · This link is single-use and expires in 10 minutes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
