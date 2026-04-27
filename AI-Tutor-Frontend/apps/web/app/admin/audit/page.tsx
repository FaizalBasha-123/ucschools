'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Search, ArrowRight } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Badge } from '@/components/ui/badge';

const log = createLogger('AdminAudit');

interface AuditLog {
  id: string;
  account_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor: string;
  before_state: any;
  after_state: any;
  created_at: string;
}

export default function AdminAuditPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logsList, setLogsList] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/audit', { cache: 'no-store' });
      
      if (res.status === 401) {
        router.push('/operator');
        return;
      }
      
      if (!res.ok) {
        throw new Error('Failed to fetch audit logs');
      }

      const data = await res.json();
      if (data.success && data.logs) {
        setLogsList(data.logs);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      log.error('Failed to fetch audit logs', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [router]);

  const filteredLogs = logsList.filter(log => 
    search === '' || 
    log.event_type.toLowerCase().includes(search.toLowerCase()) ||
    log.account_id.toLowerCase().includes(search.toLowerCase()) ||
    log.entity_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex w-full min-h-[100dvh] bg-neutral-50 dark:bg-neutral-900/50">
      <EnterpriseSidebar 
        variant="admin"
        onSignOut={async () => {
          try {
            await fetch('/api/operator/auth/logout', { method: 'POST' });
          } catch (e) {}
          router.push('/operator');
        }} 
      />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8 pt-12">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                <FileText className="size-8 text-primary" />
                System Audit Trails
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Immutable ledger of financial and operational system events.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border/60 bg-neutral-50 dark:bg-neutral-900/50 flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder="Search by event, account, or entity ID..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-white dark:bg-neutral-900 focus:outline-none focus:border-primary text-sm"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50 border-b border-border/60">
                  <tr>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Timestamp</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Event & Actor</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Entity</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">State Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                        <p>Scanning ledgers...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-red-500">
                        <p>{error}</p>
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <p>No audit logs match criteria.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((item) => (
                      <tr key={item.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                        <td className="px-6 py-4 text-muted-foreground text-xs whitespace-nowrap">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-primary mb-1">{item.event_type}</div>
                          <div className="text-xs text-muted-foreground">Actor: {item.actor}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide bg-neutral-100 dark:bg-neutral-800">{item.entity_type}</Badge>
                          </div>
                          <div className="font-mono text-xs mt-1 text-muted-foreground">{item.entity_id}</div>
                          <div className="text-xs text-muted-foreground mt-1">Acc: {item.account_id.slice(0, 8)}...</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1 text-xs font-mono bg-neutral-50 dark:bg-neutral-900 rounded p-2 overflow-x-auto max-w-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-12 shrink-0">Before:</span>
                              <span className="truncate opacity-70">{JSON.stringify(item.before_state) || '{}'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-12 shrink-0">After:</span>
                              <span className="truncate text-emerald-600 dark:text-emerald-400">{JSON.stringify(item.after_state) || '{}'}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-border/60 bg-neutral-50 dark:bg-neutral-900/50 text-xs text-muted-foreground flex justify-between items-center">
              <span>Showing {filteredLogs.length} events</span>
              <span className="italic">Compliant Audit Trail</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
