'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowLeft, Phone, ShieldCheck } from 'lucide-react';
import { setAuthSession } from '@/lib/auth/session';
import type { ConfirmationResult } from 'firebase/auth';

type Step = 'phone' | 'otp' | 'verifying';

function VerifyPhoneContent() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const partialAuthToken = useRef<string | null>(null);
  const partialEmail = useRef<string | null>(null);

  useEffect(() => {
    partialAuthToken.current = sessionStorage.getItem('partialAuthToken');
    partialEmail.current = sessionStorage.getItem('partialAuthEmail');
    if (!partialAuthToken.current) {
      router.replace('/auth');
    }
  }, [router]);

  const handleSendOtp = useCallback(async () => {
    setError(null);
    const fullPhone = `${countryCode}${phone.replace(/\D/g, '')}`;
    if (fullPhone.length < 10) {
      setError('Please enter a valid phone number.');
      return;
    }
    setLoading(true);
    try {
      // Dynamic import to avoid SSR issues with Firebase
      const { sendPhoneOtp, clearRecaptchaVerifier } = await import('@/lib/auth/firebase');
      clearRecaptchaVerifier(); // Reset in case of retry
      const result = await sendPhoneOtp(fullPhone);
      setConfirmationResult(result);
      setStep('otp');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/invalid-phone-number')) {
        setError('Invalid phone number format. Please include your country code.');
      } else if (msg.includes('auth/too-many-requests')) {
        setError('Too many attempts. Please wait a few minutes and try again.');
      } else if (msg.includes('auth/quota-exceeded')) {
        setError('SMS quota exceeded. Please try again later.');
      } else {
        setError(`Failed to send OTP: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [phone, countryCode]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...otp];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || '';
    }
    setOtp(next);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  };

  const handleVerifyOtp = useCallback(async () => {
    setError(null);
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter the 6-digit code.');
      return;
    }
    if (!confirmationResult) {
      setError('Session expired. Please request a new code.');
      return;
    }
    setStep('verifying');
    setLoading(true);
    try {
      const credential = await confirmationResult.confirm(code);
      const firebaseIdToken = await credential.user.getIdToken();

      // Send to backend to bind phone and activate account
      const res = await fetch('/api/auth/bind-phone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          firebase_id_token: firebaseIdToken,
          partial_auth_token: partialAuthToken.current,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || json.details || 'Phone verification failed');
      }

      const data = json.data || json;
      setAuthSession({
        token: data.session_token,
        accountId: data.account_id,
        email: data.email,
      });

      // Clean up partial auth data
      sessionStorage.removeItem('partialAuthToken');
      sessionStorage.removeItem('partialAuthAccountId');
      sessionStorage.removeItem('partialAuthEmail');

      // Check if this was a signup flow
      const authMode = sessionStorage.getItem('authMode');
      sessionStorage.removeItem('authMode');
      sessionStorage.removeItem('postLoginNext');

      if (authMode === 'signup') {
        router.replace('/auth?mode=signin');
      } else {
        router.replace('/check-billing');
      }
    } catch (err: unknown) {
      setStep('otp');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth/invalid-verification-code')) {
        setError('Invalid code. Please check and try again.');
      } else if (msg.includes('auth/code-expired')) {
        setError('Code expired. Please request a new one.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [otp, confirmationResult, router]);

  return (
    <main className="relative min-h-screen bg-neutral-50 text-neutral-900 flex flex-col items-center justify-center font-sans tracking-tight">
      <button
        type="button"
        onClick={() => router.push('/auth')}
        className="fixed top-6 left-6 z-50 flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-600 shadow-sm transition-all hover:bg-neutral-50 hover:text-neutral-900 md:top-8 md:left-8"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      {/* Hidden reCAPTCHA container */}
      <div id="recaptcha-container" ref={recaptchaRef} />

      {/* Top Header */}
      <div className="mb-6 flex flex-col items-center justify-center">
        <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-2xl border-2 border-emerald-400/40 bg-gradient-to-br from-emerald-50 to-white shadow-lg shadow-emerald-500/10">
          {step === 'verifying' ? (
            <Loader2 className="size-6 animate-spin text-emerald-600" />
          ) : step === 'otp' ? (
            <ShieldCheck className="size-6 text-emerald-600" />
          ) : (
            <Phone className="size-6 text-emerald-600" />
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          {step === 'verifying'
            ? 'Verifying...'
            : step === 'otp'
              ? 'Enter verification code'
              : 'Verify your phone'}
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500 max-w-xs text-center">
          {step === 'verifying'
            ? 'Securing your account. Please wait.'
            : step === 'otp'
              ? `We sent a 6-digit code to ${countryCode}${phone}`
              : 'A one-time phone verification is required to secure your account.'}
        </p>
        {partialEmail.current && step === 'phone' && (
          <p className="mt-1 text-xs text-neutral-400">
            Signing in as <span className="font-medium text-neutral-600">{partialEmail.current}</span>
          </p>
        )}
      </div>

      {/* Card */}
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-xl border border-neutral-200/60">
        {step === 'phone' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-700 tracking-wide">Phone Number</label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="h-[44px] w-[90px] rounded-md border border-neutral-300 bg-neutral-50 px-2 text-sm text-neutral-700 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                >
                  <option value="+91">🇮🇳 +91</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+61">🇦🇺 +61</option>
                  <option value="+86">🇨🇳 +86</option>
                  <option value="+81">🇯🇵 +81</option>
                  <option value="+49">🇩🇪 +49</option>
                  <option value="+33">🇫🇷 +33</option>
                  <option value="+971">🇦🇪 +971</option>
                  <option value="+65">🇸🇬 +65</option>
                  <option value="+60">🇲🇾 +60</option>
                  <option value="+82">🇰🇷 +82</option>
                </select>
                <input
                  type="tel"
                  placeholder="Enter phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                  autoFocus
                  className="h-[44px] flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-700 transition-colors placeholder:text-neutral-400 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                />
              </div>
            </div>

            <button
              onClick={handleSendOtp}
              disabled={loading || !phone.trim()}
              className="flex h-[44px] w-full items-center justify-center rounded-md bg-emerald-500 px-4 text-sm font-semibold text-white transition-all hover:bg-emerald-600 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send verification code'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-5">
            <div className="flex justify-center gap-2.5">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onPaste={i === 0 ? handleOtpPaste : undefined}
                  autoFocus={i === 0}
                  disabled={loading}
                  className="h-12 w-11 rounded-lg border-2 border-neutral-200 bg-neutral-50 text-center text-lg font-bold text-neutral-800 transition-all focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50"
                />
              ))}
            </div>

            <button
              onClick={handleVerifyOtp}
              disabled={loading || otp.join('').length !== 6}
              className="flex h-[44px] w-full items-center justify-center rounded-md bg-emerald-500 px-4 text-sm font-semibold text-white transition-all hover:bg-emerald-600 hover:shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & continue'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setOtp(['', '', '', '', '', '']);
                  setConfirmationResult(null);
                  setError(null);
                  setStep('phone');
                }}
                disabled={loading}
                className="text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                ← Change phone number
              </button>
            </div>
          </div>
        )}

        {step === 'verifying' && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <p className="text-sm text-neutral-500">Activating your account...</p>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-md border border-rose-200/60 bg-rose-50 p-3 text-center text-[13px] leading-relaxed text-rose-700">
            {error}
          </div>
        )}
      </div>

      {/* Security note */}
      <p className="mt-6 max-w-xs text-center text-[11px] text-neutral-400 leading-relaxed">
        Phone verification is a one-time security step. Your number is used solely for account verification and is never shared.
      </p>
    </main>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-neutral-50" />}>
      <VerifyPhoneContent />
    </Suspense>
  );
}
