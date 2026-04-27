'use client';

import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { authHeaders, apiFetch } from '@/lib/auth/session';

export function CreditsDisplay() {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    async function loadCredits() {
      try {
        const res = await apiFetch('/api/billing/dashboard', {
          method: 'GET',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setCredits(data.data?.entitlement?.credit_balance ?? 0);
        }
      } catch (err) {
        console.error('Failed to load credits for header:', err);
      }
    }
    loadCredits();
    // Refresh credits every 30 seconds
    const interval = setInterval(loadCredits, 30000);
    return () => clearInterval(interval);
  }, []);

  if (credits === null) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 shadow-sm transition-all hover:scale-105 active:scale-95">
      <Zap size={14} className="text-emerald-600 fill-emerald-600 animate-pulse" />
      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
        {credits} Credits
      </span>
    </div>
  );
}
