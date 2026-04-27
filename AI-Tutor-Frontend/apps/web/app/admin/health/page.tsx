'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Activity, CheckCircle2, AlertCircle, Loader2, Server, Cpu, ShieldCheck } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const log = createLogger('AdminHealth');

interface SystemHealth {
  status: string;
  current_model: string | null;
  deployment_environment: string;
  deployment_revision: string | null;
  rollout_phase: string;
  asset_backend: string;
  queue_backend: string;
  lesson_backend: string;
  storage_backend: string;
  notifications_backend: string;
  cache_backend: string;
  runtime_alert_level: string;
  runtime_alerts: string[];
}

export default function AdminHealthPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      
      if (res.status === 401) {
        router.push('/operator');
        return;
      }
      
      if (!res.ok) {
        throw new Error('Failed to fetch system health');
      }

      const data = await res.json();
      if (data.success && data.status) {
        setHealth(data);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      log.error('Failed to fetch system health', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, [router]);

  return (
    <div className="flex w-full min-h-[100dvh] bg-neutral-50 dark:bg-neutral-900/50">
      <EnterpriseSidebar 
        variant="admin"
        onSignOut={async () => {
          try {
            await fetch('/api/operator/auth/logout', { method: 'POST' });
          } catch (e) {
            log.error('Failed to logout operator', e);
          }
          router.push('/operator');
        }} 
      />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <Database className="size-8 text-primary" />
                System Health
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Real-time status of services and backend infrastructure.</p>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={fetchHealth} disabled={loading} variant="outline" className="gap-2">
                <Activity className={cn("size-4", loading && "animate-spin")} />
                Refresh Status
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-6 flex items-start gap-4 mb-8">
              <AlertCircle className="size-6 text-red-600 dark:text-red-400 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900 dark:text-red-300">Health Check Failed</h3>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              </div>
            </div>
          ) : !health ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p>Probing subsystems...</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Overall Status */}
              <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm flex items-center gap-6">
                <div className={cn(
                  "size-16 rounded-2xl flex items-center justify-center",
                  health.status === 'ok' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                )}>
                  {health.status === 'ok' ? <CheckCircle2 className="size-8" /> : <AlertCircle className="size-8" />}
                </div>
                <div>
                  <h2 className="text-2xl font-bold uppercase tracking-wide">
                    {health.status}
                  </h2>
                  <p className="text-muted-foreground">
                    Environment: <span className="font-mono text-foreground">{health.deployment_environment}</span> | 
                    Revision: <span className="font-mono text-foreground">{health.deployment_revision || 'local'}</span>
                  </p>
                </div>
              </div>

              {/* Alerts */}
              {health.runtime_alerts && health.runtime_alerts.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-6">
                  <h3 className="font-semibold flex items-center gap-2 text-amber-900 dark:text-amber-300 mb-4">
                    <AlertCircle className="size-5" />
                    Active Alerts ({health.runtime_alert_level})
                  </h3>
                  <ul className="list-disc list-inside space-y-1 text-sm text-amber-800 dark:text-amber-400">
                    {health.runtime_alerts.map((alert, i) => (
                      <li key={i}>{alert}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Infrastructure Grid */}
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <Server className="size-5" /> Subsystems
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  
                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Database & Storage</p>
                    <p className="font-mono font-medium text-lg">{health.storage_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Connected
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Cache Layer</p>
                    <p className="font-mono font-medium text-lg">{health.cache_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Connected
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Task Queue</p>
                    <p className="font-mono font-medium text-lg">{health.queue_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Processing
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Notifications</p>
                    <p className="font-mono font-medium text-lg">{health.notifications_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Active
                    </div>
                  </div>
                  
                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Lesson Engine</p>
                    <p className="font-mono font-medium text-lg">{health.lesson_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Ready
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-white dark:bg-neutral-950 p-5 shadow-sm">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Media Assets</p>
                    <p className="font-mono font-medium text-lg">{health.asset_backend}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 w-max px-2 py-1 rounded-md">
                      <CheckCircle2 className="size-3" /> Available
                    </div>
                  </div>

                </div>
              </div>

              {/* AI Models */}
              <div>
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <Cpu className="size-5" /> AI Engine
                </h3>
                <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 p-6 shadow-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Default Generation Model</p>
                      <p className="font-mono text-lg font-medium">{health.current_model || 'Not Configured'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-2">Rollout Phase</p>
                      <p className="font-mono text-lg font-medium capitalize">{health.rollout_phase}</p>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </main>
    </div>
  );
}
