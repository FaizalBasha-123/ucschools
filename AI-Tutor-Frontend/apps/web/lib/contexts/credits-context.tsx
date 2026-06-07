'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { apiFetch, authHeaders, hasAuthSessionHint } from '@/lib/auth/session';

/** Round credits to 1 decimal place and format consistent with the display context.
 *
 *  - < 1,000      →  `999.9`      (1 dp)
 *  - ≥ 1,000      →  `1,234`      (integer w/ locale commas)
 *  - ≥ 1,000,000  →  `1.2M`       (compact millions)
 */
export function formatCredits(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded >= 1_000_000) {
    return (rounded / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (rounded >= 1_000) {
    return Math.round(rounded).toLocaleString('en-US');
  }
  return rounded.toFixed(1);
}

/** Full locale-formatted credit value for tooltips (e.g. `"1,000,000.0 credits"`). */
export function formatCreditsFull(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + ' credits';
}

interface CreditsContextType {
  credits: number | null;
  planName: string;
  refreshCredits: (force?: boolean) => Promise<void>;
  loading: boolean;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [planName, setPlanName] = useState('Free');
  const [loading, setLoading] = useState(false);

  // Debounce ref to prevent multiple simultaneous requests on page load
  const lastFetchedAt = useRef<number>(0);
  const DEBOUNCE_MS = 2_000;

  const refreshCredits = useCallback(async (force = false) => {
    if (!hasAuthSessionHint()) return;

    const now = Date.now();
    if (!force && now - lastFetchedAt.current < DEBOUNCE_MS) return;
    lastFetchedAt.current = now;

    setLoading(true);
    try {
      const res = await apiFetch('/api/billing/dashboard', {
        cache: 'no-store',
      });
      if (res.status === 401) {
        setCredits(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const entitlement = (data.data || data)?.entitlement;
        const balance = entitlement?.credit_balance ?? null;
        if (balance !== null) {
          setCredits(Math.round(balance * 10) / 10);
        }
        const plan = entitlement?.active_subscription?.plan_code?.split('_')[0] || 'Free';
        setPlanName(plan);
      }
    } catch (err) {
      console.error('Failed to refresh credits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount only
  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  return (
    <CreditsContext.Provider value={{ credits, planName, refreshCredits, loading }}>
      {children}
    </CreditsContext.Provider>
  );
}

export function useCredits() {
  const context = useContext(CreditsContext);
  if (context === undefined) {
    throw new Error('useCredits must be used within a CreditsProvider');
  }
  return context;
}

