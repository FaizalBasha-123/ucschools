"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  CreditCard,
  Settings,
  BookOpen,
  LogOut,
  Activity,
  Users,
  Database,
  ListTodo,
  FileText,
} from 'lucide-react';
import { clearAuthSession } from '@/lib/auth/session';

interface EnterpriseSidebarProps {
  onSignOut: () => void;
  variant?: 'user' | 'admin';
}

export function EnterpriseSidebar({ onSignOut, variant = 'user' }: EnterpriseSidebarProps) {
  const pathname = usePathname();

  const userLinks = [
    { href: '/', label: 'Classrooms', icon: LayoutDashboard },
    { href: '/billing', label: 'Billing', icon: CreditCard },
    { href: '/operator', label: 'Operator', icon: Settings },
  ];

  const adminLinks = [
    { href: '/admin', label: 'Overview', icon: Activity },
    { href: '/admin/jobs', label: 'Job Queue', icon: ListTodo },
    { href: '/admin/users', label: 'User Management', icon: Users },
    { href: '/admin/audit', label: 'Audit Trails', icon: FileText },
    { href: '/admin/health', label: 'System Health', icon: Database },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
  ];

  const links = variant === 'admin' ? adminLinks : userLinks;

  return (
    <aside className="w-64 flex-shrink-0 border-r border-border/40 bg-white/50 dark:bg-neutral-950/50 backdrop-blur-xl h-[100dvh] flex flex-col justify-between">
      <div className="p-4">
        <div className="flex items-center gap-3 px-3 py-4 mb-6">
          <div className="size-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
            <BookOpen className="size-4" />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-600">
            AI-Tutor
          </span>
        </div>

        <nav className="space-y-1">
          {links.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4.5" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-border/40">
        <button
          type="button"
          onClick={() => {
            clearAuthSession();
            onSignOut();
          }}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="size-4.5 text-muted-foreground/70" />
          Sign out
        </button>
      </div>
    </aside>
  );
}