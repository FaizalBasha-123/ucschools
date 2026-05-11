'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LeftSidebar } from './left-sidebar';

interface DashboardShellProps {
  children: ReactNode;
  variant?: 'user' | 'operator';
  onSignOut: () => void;
  shellClassName?: string;
}

export function DashboardShell({ 
  children, 
  variant = 'user', 
  onSignOut,
  shellClassName
}: DashboardShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-sidebar">
      <LeftSidebar variant={variant} onSignOut={onSignOut} />

      <main 
        className={cn(
          "flex-1 flex flex-col min-w-0 relative transition-all duration-300 overflow-hidden",
          "md:my-2 md:mr-2 md:rounded-[2.5rem] bg-background md:shadow-[0_0_40px_rgba(0,0,0,0.1)] md:border md:border-sidebar-border/20",
          shellClassName
        )}
      >
        {children}
      </main>
    </div>
  );
}
