"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  Building2,
  Ticket,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Zap,
  Shield,
  Sparkles,
  Home,
  Menu,
  X,
} from 'lucide-react';
import { clearAuthSession, authHeaders } from '@/lib/auth/session';
import { motion, AnimatePresence } from 'motion/react';

interface LeftSidebarProps {
  onSignOut: () => void;
  variant?: 'user' | 'operator';
}

export function LeftSidebar({ onSignOut, variant = 'user' }: LeftSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [billingData, setBillingData] = useState<any>(null);

  const isBillingContext = pathname.startsWith('/billing');

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch('/api/billing/dashboard', {
          headers: authHeaders(),
          cache: 'no-store'
        });
        if (res.ok) {
          const json = await res.json();
          // Support both wrapped { success: true, data: { ... } } and direct format
          setBillingData(json.data || json);
        }
      } catch (err) {
        console.error('Failed to fetch billing data for sidebar:', err);
      }
    }
    fetchBilling();
  }, [pathname]);

  const userLinks = [
    { href: '/classroom', label: 'Classrooms', icon: LayoutDashboard },
    { href: '/billing', label: 'Plans and Billing', icon: CreditCard },
    { href: '/operator', label: 'Operator', icon: Settings },
  ];

  const billingLinks = [
    { href: '/billing', label: 'Overview', icon: Home },
    { href: '/billing/payment', label: 'Payment Methods', icon: CreditCard },
    { href: '/billing/invoices', label: 'Invoices', icon: Shield },
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

  let links = variant === 'operator' ? operatorLinks : (isBillingContext ? billingLinks : userLinks);

  const entitlement = billingData?.entitlement;
  const planName = entitlement?.active_subscription?.plan_code?.split('_')[0] || 'Free';
  const credits = entitlement?.credit_balance ?? 0;

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="md:hidden fixed bottom-6 left-6 z-[60] size-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xl shadow-emerald-500/30 active:scale-95 transition-all"
        aria-label="Open menu"
      >
        <Menu className="size-6 stroke-[2.5]" />
      </button>

      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 bg-black/40 z-[70] backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside 
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground h-[100dvh] transition-all duration-300 border-r border-sidebar-border shadow-2xl z-[80]",
          "fixed inset-y-0 left-0 md:relative",
          isMobileOpen ? "translate-x-0 w-64" : "-translate-x-full md:translate-x-0",
          !isMobileOpen && isCollapsed ? "md:w-20" : "md:w-64"
        )}
      >
        {/* Mobile Close Button */}
        <button
          onClick={() => setIsMobileOpen(false)}
          className="md:hidden absolute top-4 right-4 p-2 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <X className="size-5" />
        </button>

        {/* Collapse Toggle (Desktop only) */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden md:flex absolute -right-3 top-10 size-6 rounded-full bg-sidebar-primary text-sidebar-primary-foreground items-center justify-center shadow-lg hover:scale-110 transition-transform cursor-pointer"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

      {/* Header / Logo */}
      <div className="p-6">
        <div className={cn("flex items-center gap-3 mb-8", isCollapsed && "justify-center")}>
          <div className="size-10 rounded-xl bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground shadow-lg shadow-emerald-500/20 shrink-0">
            <BookOpen className="size-5" />
          </div>
          {!isCollapsed && (
            <motion.span 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xl font-bold tracking-tight whitespace-nowrap"
            >
              AI-Tutor
            </motion.span>
          )}
        </div>

        {/* Back Button for Billing Context */}
        <AnimatePresence>
          {isBillingContext && !isCollapsed && (
            <motion.button
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              onClick={() => router.push('/classroom')}
              className="flex items-center gap-2 text-[10px] font-bold text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors uppercase tracking-widest group overflow-hidden"
            >
              <ArrowLeft size={12} className="group-hover:-translate-x-1 transition-transform" />
              <span>Back to Classroom</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <nav className="space-y-1.5">
          {links.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all group relative',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  isCollapsed && "justify-center"
                )}
                title={isCollapsed ? link.label : ""}
              >
                <Icon className={cn("size-5 shrink-0", isActive ? "text-sidebar-primary" : "opacity-70 group-hover:opacity-100")} />
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="whitespace-nowrap"
                  >
                    {link.label}
                  </motion.span>
                )}
                {isActive && isCollapsed && (
                  <div className="absolute left-0 w-1 h-6 bg-sidebar-primary rounded-r-full" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Area */}
      <div className="mt-auto p-4 space-y-4">
        {/* Plan Box */}
        <AnimatePresence>
          {!isCollapsed && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={() => router.push('/billing')}
              className="p-4 rounded-2xl bg-sidebar-accent/50 border border-sidebar-border hover:bg-sidebar-accent transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-sidebar-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">Plan Status</span>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sidebar-primary/10 text-sidebar-primary uppercase">
                  {planName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-sidebar-foreground group-hover:text-sidebar-primary transition-colors capitalize truncate">
                    {planName} Plan
                  </p>
                  <p className="text-[11px] text-sidebar-foreground/40 font-medium">
                    {credits.toFixed(0)} credits
                  </p>
                </div>
                <div className="size-8 rounded-lg bg-sidebar-primary/10 flex items-center justify-center text-sidebar-primary group-hover:bg-sidebar-primary group-hover:text-sidebar-primary-foreground transition-all shrink-0">
                  <Zap size={14} fill="currentColor" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sign Out */}
        <button
          type="button"
          onClick={() => {
            clearAuthSession();
            onSignOut();
          }}
          className={cn(
            "flex w-full items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-sidebar-foreground/60 hover:bg-red-500/10 hover:text-red-400 transition-all group cursor-pointer",
            isCollapsed && "justify-center"
          )}
          title={isCollapsed ? "Sign Out" : ""}
        >
          <LogOut className="size-5 shrink-0 opacity-70 group-hover:opacity-100" />
          {!isCollapsed && <span className="whitespace-nowrap">Sign out</span>}
        </button>
      </div>
    </aside>
    </>
  );
}
