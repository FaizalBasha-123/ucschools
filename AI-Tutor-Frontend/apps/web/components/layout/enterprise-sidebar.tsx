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
  Building2,
  Ticket,
} from 'lucide-react';
import { clearAuthSession } from '@/lib/auth/session';

interface EnterpriseSidebarProps {
  onSignOut: () => void;
  variant?: 'user' | 'operator';
}

export function EnterpriseSidebar({ onSignOut, variant = 'user' }: EnterpriseSidebarProps) {
  const pathname = usePathname();

  const userLinks = [
    { href: '/', label: 'Classrooms', icon: LayoutDashboard },
    { href: '/billing', label: 'Billing', icon: CreditCard },
    { href: '/operator', label: 'Operator', icon: Settings },
  ];

  const operatorLinks = [
    { href: '/operator', label: 'Overview', icon: Activity },
    { href: '/operator/jobs', label: 'Job Queue', icon: ListTodo },
    { href: '/operator/users', label: 'User Management', icon: Users },
    { href: '/operator/promo', label: 'Promo Codes', icon: Ticket },
    { href: '/operator/schools', label: 'Schools', icon: Building2 },
    { href: '/operator/health', label: 'System Health', icon: Database },
    { href: '/operator/settings', label: 'Settings', icon: Settings },
  ];

  const links = variant === 'operator' ? operatorLinks : userLinks;

  return (
    <aside className="w-64 flex-shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground h-[100dvh] flex flex-col justify-between shadow-xl">
      <div className="p-4">
        <div className="flex items-center gap-3 px-3 py-4 mb-6">
          <div className="size-8 rounded-xl bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground shadow-lg shadow-emerald-500/20">
            <BookOpen className="size-4" />
          </div>
          <span className="text-xl font-bold tracking-tight">
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
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <Icon className={cn("size-4.5", isActive ? "text-sidebar-primary" : "opacity-70")} />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-sidebar-border/50">
        <button
          type="button"
          onClick={() => {
            clearAuthSession();
            onSignOut();
          }}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
        >
          <LogOut className="size-4.5 opacity-70" />
          Sign out
        </button>
      </div>
    </aside>
  );
}