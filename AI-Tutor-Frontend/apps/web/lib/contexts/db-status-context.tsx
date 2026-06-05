'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Loader2, Database } from 'lucide-react';

interface DbStatusContextType {
  isReady: boolean;
}

const DbStatusContext = createContext<DbStatusContextType>({
  isReady: true,
});

export function DbStatusProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(true);
  const [isWakingUp, setIsWakingUp] = useState(false);

  useEffect(() => {
    let sse: EventSource | null = null;

    const startSse = () => {
      setIsWakingUp(true);
      setIsReady(false);
      
      sse = new EventSource('/api/system/db-ready');
      
      sse.onmessage = (event) => {
        if (event.data === 'ready') {
          setIsReady(true);
          setIsWakingUp(false);
          sse?.close();
          // Optional: window.location.reload(); 
          // But it's better to just let components retry or re-render
        }
      };

      sse.onerror = () => {
        // SSE might fail if backend is restarting, just wait and it will retry
      };
    };

    const checkStatus = async () => {
      try {
        const res = await fetch('/api/system/status');
        if (!res.ok) {
          // If status fails with 500/503, it's likely the DB
          startSse();
          return;
        }
        const data = await res.json();
        if (data.db_ready === false) {
          startSse();
        }
      } catch (e) {
        // Network error or timeout
        startSse();
      }
    };

    checkStatus();

    return () => {
      sse?.close();
    };
  }, []);

  return (
    <DbStatusContext.Provider value={{ isReady }}>
      {children}
      {isWakingUp && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-md z-[9999] flex items-center justify-center animate-in fade-in duration-500">
          <div className="bg-card p-8 rounded-2xl shadow-2xl border flex flex-col items-center gap-6 max-w-sm text-center">
            <div className="relative">
              <Database className="w-16 h-16 text-primary animate-pulse" />
              <div className="absolute -bottom-1 -right-1">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Waking up Database</h2>
              <p className="text-muted-foreground leading-relaxed">
                The database is waking up from its slumber (Neon cold start). 
                This usually takes 10-20 seconds. 
              </p>
            </div>
            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
              <div className="bg-primary h-full animate-[progress_15s_ease-in-out_infinite]" />
            </div>
            <p className="text-xs text-muted-foreground italic">
              The page will become responsive automatically.
            </p>
          </div>
        </div>
      )}
    </DbStatusContext.Provider>
  );
}

export const useDbStatus = () => useContext(DbStatusContext);
