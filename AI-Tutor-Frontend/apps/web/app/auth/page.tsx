'use client';

import { useMemo, useState } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';

type AuthMode = 'signin' | 'signup';

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>('signin');
  
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);

  const nextPath = useMemo(() => searchParams.get('next') || '/', [searchParams]);

  const startGoogleLogin = async () => {
    setLoadingGoogle(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/google/login', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Unable to start Google login');
      }

      const url = json.data?.authorization_url;
      if (!url) {
        throw new Error('Missing Google authorization URL');
      }

      // Store mode in session so callback knows this is signup
      // After signup completes, user must sign in again
      sessionStorage.setItem('authMode', mode);
      sessionStorage.setItem('postLoginNext', nextPath);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoadingGoogle(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Frontend Validations
    if (!email) {
      setError('Email address is required.');
      return;
    }

    if (mode === 'signup') {
      if (!firstName || !lastName) {
        setError('First and Last name are required to sign up.');
        return;
      }
      if (!agreed) {
        setError('You must agree to the Terms of Service and Privacy Policy.');
        return;
      }
    }

    setLoadingEmail(true);

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 600));
    
    // Hardcoded API graceful rejection (since backend doesn't support email auth)
    setError('Email authentication is not currently configured in the deployment environment. Please sign in with Google for now.');
    setLoadingEmail(false);
  };

  return (
    <main className="relative min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center font-sans tracking-tight">
      <button
        type="button"
        onClick={() => router.push('/')}
        className="fixed top-6 left-6 z-50 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 md:top-8 md:left-8"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      {/* Top Header */}
      <div className="mb-6 flex flex-col items-center justify-center">
        <div className="mb-4 flex h-[48px] w-[48px] rotate-45 items-center justify-center rounded-2xl bg-white border-[8px] border-[#1ed760] shadow-[0_0_20px_rgba(30,215,96,0.3)]">
          <div className="h-4 w-4 rounded-full bg-slate-900 -rotate-45 ml-1 mb-1" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </h1>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-xl border border-slate-200/60">
        
        {/* Google Button */}
        <div className="space-y-3">
          <button
            onClick={startGoogleLogin}
            disabled={loadingGoogle || loadingEmail}
            className="group relative flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingGoogle ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <>
                <div className="absolute left-4 opacity-100 transition-opacity">
                  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#4285F4" d="M23.745 12.27c0-.827-.066-1.606-.188-2.368H12.25v4.618h6.58c-.246 1.637-1.196 2.97-2.585 3.905v3.213h4.18c2.443-2.25 3.86-5.556 3.86-9.368z" />
                    <path fill="#34A853" d="M12.25 24c3.24 0 5.955-1.076 7.94-2.912l-4.18-3.213c-1.074.72-2.453 1.15-3.76 1.15-2.89 0-5.328-1.95-6.196-4.57h-4.32v3.344C3.81 21.677 7.712 24 12.25 24z" />
                    <path fill="#FBBC05" d="M6.054 14.455c-.22-.656-.345-1.36-.345-2.085s.124-1.428.345-2.085v-3.344h-4.32C.585 8.665.05 10.455.05 12.37s.534 3.705 1.53 5.43l4.474-3.345z" />
                    <path fill="#EA4335" d="M12.25 4.708c1.782 0 3.38.613 4.64 1.815l3.49-3.49C18.196 1.076 15.48.05 12.25.05 7.713.05 3.81 2.372 1.734 6.025l4.32 3.344C6.923 6.745 9.36 4.708 12.25 4.708z" />
                  </svg>
                </div>
                {mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
              </>
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-7 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative bg-white px-3 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            OR
          </div>
        </div>

        {/* Email Form */}
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          
          {mode === 'signup' && (
            <div className="flex gap-3">
              <div className="space-y-1.5 w-full">
                <label className="text-xs font-semibold text-slate-700 tracking-wide">First Name</label>
                <input
                  type="text"
                  placeholder="Enter your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={loadingEmail}
                  className="h-[42px] w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus:border-[#1ed760]/50 focus:outline-none focus:ring-1 focus:ring-[#1ed760]/50"
                />
              </div>
              <div className="space-y-1.5 w-full">
                <label className="text-xs font-semibold text-slate-700 tracking-wide">Last Name</label>
                <input
                  type="text"
                  placeholder="Enter your Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={loadingEmail}
                  className="h-[42px] w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus:border-[#1ed760]/50 focus:outline-none focus:ring-1 focus:ring-[#1ed760]/50"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 tracking-wide">Email</label>
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loadingEmail}
              className="h-[42px] w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 transition-colors placeholder:text-slate-400 focus:border-[#1ed760]/50 focus:outline-none focus:ring-1 focus:ring-[#1ed760]/50"
            />
          </div>

          {mode === 'signup' && (
            <div className="my-5 flex items-center gap-2.5">
              <input
                type="checkbox"
                id="terms"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={loadingEmail}
                className="h-4 w-4 rounded border-slate-300 text-[#1ed760] focus:ring-[#1ed760]/50"
              />
              <label htmlFor="terms" className="text-[13px] text-slate-500 cursor-pointer">
                Agree to the <a href="#" className="font-semibold text-slate-700 hover:underline">Terms of Service</a> and <a href="#" className="font-semibold text-slate-700 hover:underline">Privacy Policy</a>
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loadingEmail || loadingGoogle}
            className="flex h-[42px] w-full mt-2 items-center justify-center rounded-md bg-[#1ed760] px-4 text-sm font-semibold text-white transition-all hover:bg-[#1fdf64] hover:shadow-[0_0_15px_rgba(30,215,96,0.3)] active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
          >
            {loadingEmail ? <Loader2 className="h-4 w-4 animate-spin text-white/80" /> : 'Continue'}
          </button>
        </form>

        {error ? (
          <div className="mt-5 rounded-md border border-amber-500/20 bg-amber-50 p-3 text-center text-[13px] leading-relaxed text-amber-700">
            {error}
          </div>
        ) : null}

        {/* Footer Link */}
        <div className="mt-8 text-center text-[13px] text-slate-500">
          {mode === 'signin' ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            className="font-semibold text-slate-900 transition-colors hover:text-slate-700"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null); // Clear errors on view switch
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <AuthPageContent />
    </Suspense>
  );
}
