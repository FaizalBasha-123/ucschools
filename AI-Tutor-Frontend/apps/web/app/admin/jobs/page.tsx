'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListTodo, Loader2, Play, Square, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const log = createLogger('AdminJobs');

interface LessonJob {
  id: string;
  account_id: string;
  lesson_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  step: string;
  message: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export default function AdminJobsPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<LessonJob[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/jobs', { cache: 'no-store' });
      
      if (res.status === 401) {
        router.push('/operator');
        return;
      }
      
      if (!res.ok) {
        throw new Error('Failed to fetch jobs');
      }

      const data = await res.json();
      if (data.success && data.jobs) {
        setJobs(data.jobs);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      log.error('Failed to fetch jobs', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [router]);

  const handleAction = async (jobId: string, action: 'cancel' | 'resume') => {
    setActionLoading(jobId);
    try {
      const res = await fetch(`/api/lessons/jobs/${jobId}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Failed to ${action} job`);
      await fetchJobs();
    } catch (err) {
      log.error(`Action ${action} failed for job ${jobId}`, err);
      alert(`Failed to ${action} job`);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="size-4 text-emerald-500" />;
      case 'failed': return <AlertCircle className="size-4 text-red-500" />;
      case 'running': return <Loader2 className="size-4 text-blue-500 animate-spin" />;
      case 'cancelled': return <Square className="size-4 text-neutral-500" />;
      default: return <ListTodo className="size-4 text-amber-500" />;
    }
  };

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
                <ListTodo className="size-8 text-primary" />
                Live Job Queue
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Real-time monitoring and process control of AI generation jobs.</p>
            </div>
            <Button onClick={fetchJobs} disabled={loading} variant="outline">
              <RotateCcw className={cn("size-4 mr-2", loading && "animate-spin")} />
              Refresh Queue
            </Button>
          </div>

          <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50 border-b border-border/60">
                  <tr>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Job ID</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Status & Step</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Last Update</th>
                    <th className="px-6 py-4 text-right font-medium text-muted-foreground">Process Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loading && jobs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                        <p>Loading queue...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-red-500">
                        <p>{error}</p>
                      </td>
                    </tr>
                  ) : jobs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <p>No active jobs found.</p>
                      </td>
                    </tr>
                  ) : (
                    jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-mono text-xs">{job.id.slice(0, 18)}...</div>
                          <div className="text-xs text-muted-foreground mt-1">Acc: {job.account_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 font-medium capitalize">
                            {getStatusIcon(job.status)} {job.status}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">Step: {job.step}</div>
                          {job.error && (
                            <div className="text-xs text-red-500 mt-1 max-w-xs truncate" title={job.error}>
                              Error: {job.error}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground text-xs">
                          {new Date(job.updated_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {['queued', 'running'].includes(job.status) && (
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                className="h-8 text-xs"
                                disabled={actionLoading === job.id}
                                onClick={() => handleAction(job.id, 'cancel')}
                              >
                                {actionLoading === job.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <Square className="size-3 mr-1" />}
                                Halt
                              </Button>
                            )}
                            {['failed', 'cancelled'].includes(job.status) && (
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                className="h-8 text-xs"
                                disabled={actionLoading === job.id}
                                onClick={() => handleAction(job.id, 'resume')}
                              >
                                {actionLoading === job.id ? <Loader2 className="size-3 animate-spin mr-1" /> : <Play className="size-3 mr-1" />}
                                Resume
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-border/60 bg-neutral-50 dark:bg-neutral-900/50 text-xs text-muted-foreground flex justify-between items-center">
              <span>Showing {jobs.length} jobs</span>
              <span className="flex items-center gap-2"><div className="size-2 rounded-full bg-emerald-500 animate-pulse"></div> Live Sync Active</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
