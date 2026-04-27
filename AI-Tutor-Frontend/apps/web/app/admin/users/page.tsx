'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, Search } from 'lucide-react';
import { EnterpriseSidebar } from '@/components/layout/enterprise-sidebar';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';

const log = createLogger('AdminUsers');

interface AdminUser {
  account_id: string;
  email: string | null;
  created_at_unix: number;
}

export default function AdminUsersPage() {
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/users', { cache: 'no-store' });
        
        if (res.status === 401) {
          router.push('/operator');
          return;
        }
        
        if (!res.ok) {
          throw new Error('Failed to fetch users');
        }

        const data = await res.json();
        if (data.success && data.users) {
          setUsers(data.users);
        } else {
          throw new Error('Invalid response format');
        }
      } catch (err) {
        log.error('Failed to fetch users', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [router]);

  const filteredUsers = users.filter(user => 
    search === '' || 
    user.email?.toLowerCase().includes(search.toLowerCase()) ||
    user.account_id.toLowerCase().includes(search.toLowerCase())
  );

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
                <Users className="size-8 text-primary" />
                User Management
              </h1>
              <p className="text-sm text-muted-foreground mt-1">View and manage registered accounts.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-white dark:bg-neutral-950 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border/60 bg-neutral-50 dark:bg-neutral-900/50 flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder="Search by email or ID..." 
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
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Account ID</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-6 py-4 text-left font-medium text-muted-foreground">Joined At</th>
                    <th className="px-6 py-4 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-3 opacity-50" />
                        <p>Loading users...</p>
                      </td>
                    </tr>
                  ) : error ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-red-500">
                        <p>{error}</p>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground">
                        <p>No users found.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.account_id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors">
                        <td className="px-6 py-4 font-mono text-xs">{user.account_id}</td>
                        <td className="px-6 py-4 font-medium">{user.email || <span className="text-muted-foreground italic">No Email</span>}</td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {new Date(user.created_at_unix * 1000).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" className="text-xs" disabled>
                            View Details
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-border/60 bg-neutral-50 dark:bg-neutral-900/50 text-xs text-muted-foreground flex justify-between items-center">
              <span>Showing {filteredUsers.length} users</span>
              <span className="italic">Read-only view</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
