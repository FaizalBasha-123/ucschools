'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setAuthSession, clearAuthSession } from '@/lib/auth/session';
import { motion } from 'motion/react';
import { Loader2, ShieldCheck, AlertCircle } from 'lucide-react';

function AuthCallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    const run = async () => {
      try {
        const response = await fetch(`/api/auth/google/callback?${queryString}`, {
          cache: 'no-store',
        });
        const json = await response.json();

        if (!response.ok || !json.success) {
          throw new Error(json.error || 'Authentication failed');
        }

        const data = json.data || json;
        if (data.status && typeof data.status === 'string' && data.status === 'partial_auth') {
          // Phone verification required — store partial context and redirect
          if (data.partial_auth_token) {
            sessionStorage.setItem('partialAuthToken', data.partial_auth_token);
          }
          if (data.account_id) {
            sessionStorage.setItem('partialAuthAccountId', data.account_id);
          }
          if (data.email) {
            sessionStorage.setItem('partialAuthEmail', data.email);
          }
          const target = data.redirect_to || '/auth/verify-phone';
          router.replace(target);
          return;
        }
        if (data.status && typeof data.status === 'string' && data.status !== 'active') {
          throw new Error(`Authentication incomplete: ${data.status}`);
        }

        setAuthSession({
          token: data.session_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in ?? undefined,
          accountId: data.account_id,
          email: data.email,
        });

        // Check if this was a signup flow
        // If so, clear session and require user to sign in again (separate signin step)
        const authMode = sessionStorage.getItem('authMode');
        sessionStorage.removeItem('authMode');
        // We keep postLoginNext for the check-billing page to use

        if (authMode === 'signup') {
          // Signup flow: clear session and redirect to signin
          sessionStorage.removeItem('postLoginNext');
          clearAuthSession();
          router.replace('/auth?mode=signin');
        } else {
          // Signin flow: proceed to billing check
          router.replace('/check-billing');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    run();
  }, [queryString, router]);

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 relative overflow-hidden flex items-center justify-center">
      {/* Enterprise Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[20%] w-[500px] h-[500px] rounded-full bg-emerald-500/10 dark:bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[400px] h-[400px] rounded-full bg-indigo-500/10 dark:bg-indigo-500/5 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rounded-3xl border border-neutral-200/50 dark:border-neutral-800/50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl p-8 md:p-10 text-center relative overflow-hidden">
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-indigo-500" />

            {!error ? (
              <div className="flex flex-col items-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-emerald-500/20 dark:bg-emerald-500/10 rounded-full animate-ping" />
                  <div className="relative h-16 w-16 bg-white dark:bg-neutral-800 rounded-full border border-neutral-100 dark:border-neutral-700 shadow-sm flex items-center justify-center">
                    <ShieldCheck className="h-8 w-8 text-emerald-500" />
                    <Loader2 className="h-16 w-16 text-emerald-500/30 absolute animate-spin" />
                  </div>
                </div>
                
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-neutral-900 dark:text-white mb-3">
                  Authenticating
                </h1>
                <p className="text-sm md:text-base text-neutral-500 dark:text-neutral-400 font-medium max-w-[250px] mx-auto">
                  Establishing secure enterprise session...
                </p>
                
                <div className="mt-8 w-full max-w-[200px] mx-auto">
                  <div className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="h-16 w-16 bg-rose-100 dark:bg-rose-500/10 rounded-full flex items-center justify-center mb-6">
                  <AlertCircle className="h-8 w-8 text-rose-600 dark:text-rose-500" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white mb-3">
                  Authentication Failed
                </h1>
                <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/5 px-4 py-3 rounded-xl border border-rose-100 dark:border-rose-500/10">
                  {error}
                </p>
                <button 
                  onClick={() => router.replace('/auth?mode=signin')}
                  className="mt-8 px-6 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-semibold rounded-full hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors"
                >
                  Return to Sign In
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </main>
    }>
      <AuthCallbackPageContent />
    </Suspense>
  );
}
