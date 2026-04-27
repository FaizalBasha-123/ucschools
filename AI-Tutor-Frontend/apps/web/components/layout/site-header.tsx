'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BotOff, Sun, Moon, Monitor, Settings, X, Menu } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTheme } from '@/lib/hooks/use-theme';
import { SettingsDialog } from '@/components/settings';
import { UserMenu } from './user-menu';
import { clearAuthSession, hasAuthSessionHint, verifyAuthSession } from '@/lib/auth/session';
import { cn } from '@/lib/utils';
import type { SettingsSection } from '@/lib/types/settings';

export type SiteHeaderVariant = 'landing' | 'pricing' | 'dashboard';

interface SiteHeaderProps {
  variant?: SiteHeaderVariant;
}

export function SiteHeader({ variant = 'landing' }: SiteHeaderProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const [themeOpen, setThemeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [authChecking, setAuthChecking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(hasAuthSessionHint());

  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hydrateAuth = async () => {
      const hasSession = hasAuthSessionHint();
      if (!hasSession) {
        setIsAuthenticated(false);
        return;
      }
      
      // Trust the local session - don't revert to false unless we absolutely have to
      setIsAuthenticated(true);

      try {
        const ok = await verifyAuthSession();
        if (!ok) {
          // Instead of clearing everything, just log it. 
          // We let the specific page handle the redirect if a token is actually dead.
          console.warn('Background auth verification failed (401)');
        }
      } catch (error) {
        console.error('Auth check error:', error);
      }
    };
    hydrateAuth();
  }, []);

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileMenuOpen]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  const handleSignOut = () => {
    clearAuthSession();
    setIsAuthenticated(false);
    setMobileMenuOpen(false);
    router.push('/auth?next=/');
  };

  const navLinks =
    variant !== 'dashboard'
      ? [
          { label: 'Pricing', href: '/pricing' },
          { label: 'Operator', href: '/operator' },
        ]
      : [];

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-8 py-3.5 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border-b border-neutral-200/40 dark:border-border/40 shadow-sm">
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 cursor-pointer select-none group"
          onClick={() => {
            if (variant === 'landing') window.scrollTo({ top: 0, behavior: 'smooth' });
            else router.push('/');
          }}
        >
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center shadow-md shadow-primary/20 transition-transform group-hover:scale-105">
            <BotOff className="size-4.5 text-primary-foreground stroke-[2.5]" />
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-primary to-emerald-600 dark:from-primary dark:to-emerald-400 hidden sm:inline-block">
            AI-Tutor
          </span>
          {variant === 'dashboard' && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] font-bold text-neutral-500 uppercase tracking-widest hidden md:inline-block">
              Workspace
            </span>
          )}
        </div>

        {/* Desktop Right Actions */}
        <div className="hidden md:flex items-center gap-4">
          {variant !== 'dashboard' && (
            <div className="flex items-center gap-1.5">
              <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

              {/* Theme Picker */}
              <div className="relative">
                <button
                  onClick={() => setThemeOpen(!themeOpen)}
                  className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground transition-all"
                >
                  {theme === 'light' && <Sun className="w-4 h-4" />}
                  {theme === 'dark' && <Moon className="w-4 h-4" />}
                  {theme === 'system' && <Monitor className="w-4 h-4" />}
                </button>
                {themeOpen && (
                  <div className="absolute top-full mt-2 right-0 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-border/60 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
                    {(['light', 'dark', 'system'] as const).map((t_) => (
                      <button
                        key={t_}
                        onClick={() => { setTheme(t_); setThemeOpen(false); }}
                        className={cn(
                          'w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-muted/80 transition-colors flex items-center gap-2',
                          theme === t_ && 'bg-emerald-50 text-emerald-600 dark:bg-primary/5 dark:text-primary',
                        )}
                      >
                        {t_ === 'light' && <Sun className="w-4 h-4" />}
                        {t_ === 'dark' && <Moon className="w-4 h-4" />}
                        {t_ === 'system' && <Monitor className="w-4 h-4" />}
                        {t('settings.themeOptions.' + t_ as `settings.themeOptions.${typeof t_}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setSettingsOpen(true)}
                className="p-2 rounded-full text-neutral-500 hover:bg-neutral-100 dark:text-muted-foreground dark:hover:bg-muted transition-all group"
              >
                <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
              </button>
            </div>
          )}

          {variant !== 'dashboard' && <div className="w-[1px] h-5 bg-neutral-200 dark:bg-border/60 mx-1" />}

          <div className="flex items-center gap-3">
            {navLinks.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => router.push(link.href)}
                className="text-sm font-medium text-neutral-500 hover:text-neutral-900 dark:text-muted-foreground dark:hover:text-foreground transition-colors"
              >
                {link.label}
              </button>
            ))}

            {!authChecking && (
              isAuthenticated ? (
                <UserMenu onOpenSettings={() => setSettingsOpen(true)} />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => router.push('/auth?mode=signin&next=/')}
                    className="rounded-full border border-neutral-300 dark:border-border/70 bg-white dark:bg-background px-4 py-2 text-sm font-medium text-neutral-700 dark:text-foreground hover:bg-neutral-50 dark:hover:bg-muted transition-colors"
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/auth?mode=signup&next=/')}
                    className="rounded-full bg-[#1ed760] text-neutral-900 px-4 py-2 text-sm font-bold hover:bg-[#1fdf64] shadow-sm shadow-[#1ed760]/20 transition-all"
                  >
                    Get Started
                  </button>
                </>
              )
            )}
          </div>
        </div>

        {/* Mobile: Hamburger button */}
        <button
          className="md:hidden flex items-center justify-center size-9 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          <span className="relative size-5 flex flex-col justify-center items-center gap-[5px]">
            <span
              className={cn(
                'block h-[2px] w-5 rounded-full bg-current transition-all duration-300 origin-center',
                mobileMenuOpen && 'rotate-45 tranneutral-y-[7px]',
              )}
            />
            <span
              className={cn(
                'block h-[2px] rounded-full bg-current transition-all duration-300',
                mobileMenuOpen ? 'w-0 opacity-0' : 'w-5 opacity-100',
              )}
            />
            <span
              className={cn(
                'block h-[2px] w-5 rounded-full bg-current transition-all duration-300 origin-center',
                mobileMenuOpen && '-rotate-45 -tranneutral-y-[7px]',
              )}
            />
          </span>
        </button>
      </header>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Slide-in panel */}
          <div
            ref={mobileMenuRef}
            className="absolute top-0 right-0 bottom-0 w-72 bg-white dark:bg-neutral-900 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-border/40">
              <div className="flex items-center gap-2.5">
                <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-md shadow-primary/20">
                  <BotOff className="size-4 text-primary-foreground stroke-[2.5]" />
                </div>
                <span className="text-base font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-primary to-emerald-600 dark:from-primary dark:to-emerald-400">
                  AI-Tutor
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="size-8 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Nav Links */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
              {navLinks.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => { router.push(link.href); setMobileMenuOpen(false); }}
                  className="w-full flex items-center px-4 py-3 rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors text-left"
                >
                  {link.label}
                </button>
              ))}

              {/* Spacer */}
              {navLinks.length > 0 && <div className="h-px bg-neutral-100 dark:bg-border/40 mx-2 my-2" />}

              {/* Theme */}
              <div className="px-4 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Theme</p>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as const).map((t_) => (
                    <button
                      key={t_}
                      onClick={() => setTheme(t_)}
                      className={cn(
                        'flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-xs font-medium transition-all',
                        theme === t_
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-neutral-200 dark:border-border/50 text-neutral-500 dark:text-neutral-400 hover:border-primary/40',
                      )}
                    >
                      {t_ === 'light' && <Sun className="size-4" />}
                      {t_ === 'dark' && <Moon className="size-4" />}
                      {t_ === 'system' && <Monitor className="size-4" />}
                      <span className="capitalize">{t_}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div className="px-4 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Language</p>
                <LanguageSwitcher />
              </div>

              {/* Settings */}
              {variant !== 'dashboard' && (
                <button
                  onClick={() => { setSettingsOpen(true); setMobileMenuOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <Settings className="size-4" />
                  Settings
                </button>
              )}
            </nav>

            {/* Auth Actions */}
            {!authChecking && (
              <div className="px-4 pb-6 pt-3 border-t border-neutral-100 dark:border-border/40 space-y-2">
                {isAuthenticated ? (
                  <>
                    {(variant === 'landing' || variant === 'pricing') && (
                      <button
                        type="button"
                        onClick={() => { router.push('/classroom'); setMobileMenuOpen(false); }}
                        className="w-full rounded-xl bg-neutral-900 text-white dark:bg-primary dark:text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-neutral-800 transition-all"
                      >
                        Classrooms
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600 hover:bg-emerald-100 dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/20 transition-colors"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { router.push('/auth?mode=signin&next=/'); setMobileMenuOpen(false); }}
                      className="w-full rounded-xl border border-neutral-300 dark:border-border/70 bg-white dark:bg-background px-4 py-3 text-sm font-medium text-neutral-700 dark:text-foreground hover:bg-neutral-50 dark:hover:bg-muted transition-colors"
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => { router.push('/auth?mode=signup&next=/'); setMobileMenuOpen(false); }}
                      className="w-full rounded-xl bg-[#1ed760] text-neutral-900 px-4 py-3 text-sm font-bold hover:bg-[#1fdf64] shadow-sm shadow-[#1ed760]/20 transition-all"
                    >
                      Get Started
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />
    </>
  );
}
