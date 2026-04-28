'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch, hasAuthSessionHint } from '@/lib/auth/session';

interface CreditsContextType {
  credits: number | null;
  refreshCredits: () => Promise<void>;
  loading: boolean;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

const CREDITS_CACHE_KEY = 'ai_tutor_credits_cache';

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Instant hydration from localStorage
  useEffect(() => {
    const cached = localStorage.getItem(CREDITS_CACHE_KEY);
    if (cached !== null) {
      setCredits(Number(cached));
    }
  }, []);

  const refreshCredits = async () => {
    if (!hasAuthSessionHint()) return;
    
    setLoading(true);
    try {
      const res = await apiFetch('/api/billing/dashboard', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const balance = data.data?.entitlement?.credit_balance ?? 0;
        setCredits(balance);
        localStorage.setItem(CREDITS_CACHE_KEY, String(balance));
      }
    } catch (err) {
      console.error('Failed to refresh credits:', err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Initial background refresh
  useEffect(() => {
    refreshCredits();
    
    // Auto refresh every 60s
    const interval = setInterval(refreshCredits, 60000);
    return () => clearInterval(interval);
  }, []);

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
