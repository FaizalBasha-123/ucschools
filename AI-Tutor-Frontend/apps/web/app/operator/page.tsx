'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type OperatorAuthStep = 'email' | 'otp' | 'success';

export default function OperatorLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<OperatorAuthStep>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Handle resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Step 1: Request OTP via email
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!email.trim()) {
      setError('Email address is required');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/operator/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to request OTP');
      }

      setStep('otp');
      setResendCooldown(60);
      toast.success('OTP sent to your email', {
        description: `Check ${email} for the 6-digit code`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to request OTP';
      setError(message);
      toast.error('OTP request failed', { description: message });
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP code
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!otp.trim() || otp.length !== 6) {
      setError('Please enter a valid 6-digit code');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/operator/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp }),
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid OTP code');
      }

      // Session cookie is automatically set by the API
      setStep('success');
      toast.success('Successfully authenticated', {
        description: 'Redirecting to admin panel...',
      });

      // Redirect after a brief delay
      setTimeout(() => {
        router.push('/admin');
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify OTP';
      setError(message);
      toast.error('Verification failed', { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-8 bg-gradient-to-br from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      {/* Back button */}
      <Link
        href="/"
        className="absolute top-4 left-4 md:top-6 md:left-6 z-20 flex items-center gap-2 px-3 py-2 md:px-4 md:py-2.5 rounded-xl bg-white/80 dark:bg-neutral-800/80 backdrop-blur border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-xs md:text-sm font-semibold">Back</span>
      </Link>

      {/* Main content */}
      <div className="w-full max-w-md relative z-10">
        {step === 'success' ? (
          // Success Screen
          <div className="text-center space-y-6 animate-in fade-in duration-300">
            <div className="flex justify-center">
              <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-3 animate-pulse">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
                Authentication Complete
              </h1>
              <p className="text-neutral-600 dark:text-neutral-400">
                Welcome back! Redirecting to the admin panel...
              </p>
            </div>
            <div className="flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          </div>
        ) : (
          // Email or OTP input form
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="rounded-2xl bg-primary/10 p-3">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white">
                {step === 'email' ? 'Operator Login' : 'Verify Code'}
              </h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {step === 'email'
                  ? 'Enter your email to receive a one-time authentication code'
                  : `We sent a 6-digit code to ${email}`}
              </p>
            </div>

            {/* Form Card */}
            <div className="rounded-2xl border border-neutral-200/60 dark:border-neutral-700/60 bg-white dark:bg-neutral-800 p-6 md:p-8 shadow-sm">
              {/* Error message */}
              {error && (
                <div className="mb-6 flex items-start gap-3 rounded-lg bg-red-50 dark:bg-red-950/30 p-4">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-900 dark:text-red-300">{error}</p>
                  </div>
                </div>
              )}

              {step === 'email' ? (
                // Email input form
                <form onSubmit={handleRequestOtp} className="space-y-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="email"
                      className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      Email Address
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="operator@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="w-full h-11 px-4 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending code...
                      </>
                    ) : (
                      'Send Authentication Code'
                    )}
                  </button>
                </form>
              ) : (
                // OTP input form
                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="space-y-2">
                    <label
                      htmlFor="otp"
                      className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-2"
                    >
                      <Lock className="h-4 w-4" />
                      Verification Code
                    </label>
                    <input
                      id="otp"
                      type="text"
                      placeholder="000000"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      disabled={loading}
                      maxLength={6}
                      className="w-full h-11 px-4 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 text-center text-lg font-mono tracking-widest"
                    />
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Check your email for the 6-digit code
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.length !== 6}
                    className="w-full h-11 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify & Login'
                    )}
                  </button>

                  {/* Resend button */}
                  <button
                    type="button"
                    onClick={async () => {
                      setResendCooldown(60);
                      try {
                        const response = await fetch('/api/operator/auth/request-otp', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email }),
                          cache: 'no-store',
                        });

                        if (!response.ok) {
                          throw new Error('Failed to resend code');
                        }

                        toast.success('Code resent', {
                          description: `New code sent to ${email}`,
                        });
                      } catch (err) {
                        toast.error('Failed to resend code');
                      }
                    }}
                    disabled={resendCooldown > 0 || loading}
                    className="w-full text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Didn't receive the code? Resend"}
                  </button>

                  {/* Back to email */}
                  <button
                    type="button"
                    onClick={() => {
                      setStep('email');
                      setOtp('');
                      setError(null);
                      setResendCooldown(0);
                    }}
                    disabled={loading}
                    className="w-full text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 disabled:opacity-50 transition-colors"
                  >
                    Use a different email address
                  </button>
                </form>
              )}
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
              By logging in, you agree to our{' '}
              <Link href="#" className="underline hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                Terms of Service
              </Link>
              {' '}and{' '}
              <Link href="#" className="underline hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors">
                Privacy Policy
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
