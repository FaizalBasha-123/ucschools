'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Shield, Server, Key, Info, Loader2 } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminSettings');

interface AdminSettings {
  operator_roles: string;
  api_base_url: string;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        
        if (res.status === 401) {
          router.push('/operator');
          return;
        }
        
        if (!res.ok) {
          throw new Error('Failed to fetch settings');
        }

        const data = await res.json();
        if (data.success && data.operator_roles !== undefined) {
          setSettings(data);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        log.error('Failed to fetch settings', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
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
        <div className="max-w-4xl mx-auto p-8 pt-12">
          
          <div className="mb-10">
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Settings className="size-8 text-primary" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Platform configuration and operator mappings.</p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p>Loading configuration...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-6 flex items-start gap-4 mb-8">
              <Info className="size-6 text-red-600 dark:text-red-400 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900 dark:text-red-300">Failed to Load Settings</h3>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{error}</p>
              </div>
            </div>
          ) : settings ? (
            <div className="space-y-8">
              
              <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 p-4 flex items-start gap-3">
                <Info className="size-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-blue-900 dark:text-blue-300">
                  <strong>Read-only view.</strong> Core platform settings and operator roles are securely configured via environment variables and cannot be modified at runtime.
                </p>
              </div>

              {/* Operator Access Control */}
              <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Shield className="size-5 text-primary" /> Access Control
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Emails mapped to operator roles. Only these accounts can receive OTPs.
                  </p>
                </div>
                <div className="p-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">AI_TUTOR_OPERATOR_EMAIL_ROLES</label>
                    <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-4 font-mono text-sm break-all">
                      {settings.operator_roles || <span className="italic text-muted-foreground">Not configured (All operator logins disabled)</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* API Configuration */}
              <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-border/60 bg-neutral-50/50 dark:bg-neutral-900/30">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Server className="size-5 text-primary" /> Core Endpoints
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Routing and backend base URLs for the frontend application.
                  </p>
                </div>
                <div className="p-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">AI_TUTOR_API_BASE_URL</label>
                    <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg p-4 font-mono text-sm break-all">
                      {settings.api_base_url}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          ) : null}

        </div>
      </main>
    </div>
  );
}
