'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setAuthSession, clearAuthSession } from '@/lib/auth/session';

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
        if (data.status && typeof data.status === 'string' && data.status !== 'active') {
          throw new Error(`Authentication incomplete: ${data.status}`);
        }

        setAuthSession({
          token: data.session_token,
          accountId: data.account_id,
          email: data.email,
        });

        // Check if this was a signup flow
        // If so, clear session and require user to sign in again (separate signin step)
        const authMode = sessionStorage.getItem('authMode');
        sessionStorage.removeItem('authMode');
        sessionStorage.removeItem('postLoginNext');

        if (authMode === 'signup') {
          // Signup flow: clear session and redirect to signin
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
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-semibold tracking-tight">Signing you in...</h1>
          <p className="mt-2 text-sm text-slate-600">Finalizing secure session and loading your dashboard.</p>
          {error ? <p className="mt-5 text-sm text-rose-700">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-100" />}>
      <AuthCallbackPageContent />
    </Suspense>
  );
}
