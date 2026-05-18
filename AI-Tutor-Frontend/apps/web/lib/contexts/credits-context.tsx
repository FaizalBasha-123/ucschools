'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { apiFetch, hasAuthSessionHint } from '@/lib/auth/session';

interface CreditsContextType {
  credits: number | null;
  refreshCredits: () => Promise<void>;
  loading: boolean;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCredits = useCallback(async () => {
    if (!hasAuthSessionHint()) return;

    setLoading(true);
    try {
      const res = await apiFetch('/api/billing/dashboard', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.status === 401) {
        // Not logged in with user session (e.g. on an operator-only page)
        setCredits(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const balance = data?.entitlement?.credit_balance ?? data?.data?.entitlement?.credit_balance ?? null;
        if (balance !== null) {
          setCredits(balance);
        }
      }
    } catch (err) {
      console.error('Failed to refresh credits:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    refreshCredits();

    // Auto-refresh every 60s to keep in sync
    const interval = setInterval(refreshCredits, 60_000);
    return () => clearInterval(interval);
  }, [refreshCredits]);

  return (
    <CreditsContext.Provider value={{ credits, refreshCredits, loading }}>
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
