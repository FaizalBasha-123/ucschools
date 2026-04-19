'use client';

import { useMemo, useState } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

function AuthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => searchParams.get('next') || '/', [searchParams]);

  const startGoogleLogin = async () => {
    setLoading(true);
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

      sessionStorage.setItem('postLoginNext', nextPath);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">AI-Tutor</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Sign in to continue</h1>
          <p className="mt-2 text-sm text-slate-600">
            You need to be authenticated before creating lessons and accessing your dashboard.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Next destination after login: <span className="font-semibold">{nextPath}</span>
          </div>

          <Button
            type="button"
            onClick={startGoogleLogin}
            disabled={loading}
            className="mt-8 h-11 w-full text-sm font-semibold"
          >
            {loading ? 'Redirecting...' : 'Continue with Google'}
          </Button>

          {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}

          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-6 text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
          >
            Back to home
          </button>
        </section>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-100" />}>
      <AuthPageContent />
    </Suspense>
  );
}
