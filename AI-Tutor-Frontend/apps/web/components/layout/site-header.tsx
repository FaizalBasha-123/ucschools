'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BotOff, Sun, Moon, Monitor, Settings, X, Menu } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTheme } from '@/lib/hooks/use-theme';
import { SettingsDialog } from '@/components/settings';
import { UserMenu } from './user-menu';
import { CreditsDisplay } from './credits-display';
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-4 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl border-b border-neutral-200/50 dark:border-neutral-800/50 shadow-sm transition-all duration-300">
        {/* Logo */}
        <div
          className="flex items-center gap-3 cursor-pointer select-none group"
          onClick={() => {
            if (variant === 'landing') window.scrollTo({ top: 0, behavior: 'smooth' });
            else router.push('/');
          }}
        >
          <div className="size-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 transition-transform group-hover:scale-110 group-active:scale-95">
            <BotOff className="size-5 text-white stroke-[2.5]" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black tracking-tight leading-none text-neutral-900 dark:text-white">
              AI-Tutor
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 mt-0.5">
              Open Source
            </span>
          </div>
        </div>

        {/* Desktop Right Actions */}
        <div className="hidden md:flex items-center gap-6">
          <nav className="flex items-center gap-6 mr-2">
            {navLinks.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => router.push(link.href)}
                className="text-sm font-bold text-neutral-500 hover:text-emerald-600 dark:text-neutral-400 dark:hover:text-emerald-400 transition-colors"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="w-[1px] h-6 bg-neutral-200 dark:bg-neutral-800" />

          <div className="flex items-center gap-4">
            {!authChecking && (
              isAuthenticated ? (
                <div className="flex items-center gap-4">
                  <CreditsDisplay />
                  <div className="w-[1px] h-6 bg-neutral-200 dark:bg-neutral-800" />
                  <UserMenu onOpenSettings={() => setSettingsOpen(true)} />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => router.push('/auth?mode=signin&next=/')}
                    className="text-sm font-bold text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors px-2"
                  >
                    Log in
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/auth?mode=signup&next=/')}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-2.5 text-sm font-black hover:shadow-lg hover:shadow-emerald-500/25 active:scale-95 transition-all"
                  >
                    Get Started
                  </button>
                </div>
              )
            )}

            <div className="w-[1px] h-6 bg-neutral-200 dark:bg-neutral-800" />

            {/* Utility Tools */}
            <div className="flex items-center gap-1">
              {variant !== 'landing' && <LanguageSwitcher onOpen={() => setThemeOpen(false)} />}

              <div className="relative">
                <button
                  onClick={() => setThemeOpen(!themeOpen)}
                  className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-all"
                >
                  {theme === 'light' && <Sun className="w-4.5 h-4.5" />}
                  {theme === 'dark' && <Moon className="w-4.5 h-4.5" />}
                  {theme === 'system' && <Monitor className="w-4.5 h-4.5" />}
                </button>
                {themeOpen && (
                  <div className="absolute top-full mt-3 right-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl overflow-hidden z-50 min-w-[160px] p-1.5 animate-in fade-in zoom-in-95 duration-200">
                    {(['light', 'dark', 'system'] as const).map((t_) => (
                      <button
                        key={t_}
                        onClick={() => { setTheme(t_); setThemeOpen(false); }}
                        className={cn(
                          'w-full px-4 py-2.5 text-left text-xs font-bold rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-3',
                          theme === t_ ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400',
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

              {variant !== 'landing' && (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="p-2 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-all group"
                >
                  <Settings className="w-4.5 h-4.5 group-hover:rotate-90 transition-transform duration-500" />
                </button>
              )}
            </div>
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
              <div
                className="flex items-center gap-2.5 cursor-pointer select-none"
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (variant === 'landing') window.scrollTo({ top: 0, behavior: 'smooth' });
                  else router.push('/');
                }}
              >
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
              {variant !== 'landing' && (
                <div className="px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-2">Language</p>
                  <LanguageSwitcher />
                </div>
              )}

              {/* Settings */}
              {variant !== 'dashboard' && variant !== 'landing' && (
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
