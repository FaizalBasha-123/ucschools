'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Settings, 
  LogOut, 
  LayoutDashboard, 
  ChevronDown,
  CreditCard
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { clearAuthSession } from '@/lib/auth/session';
import { useI18n } from '@/lib/hooks/use-i18n';

interface UserMenuProps {
  onOpenSettings: () => void;
}

export function UserMenu({ onOpenSettings }: UserMenuProps) {
  const router = useRouter();
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = () => {
    clearAuthSession();
    router.push('/auth?mode=signin');
  };

  const menuItems = [
    { 
      label: 'Classrooms', 
      icon: LayoutDashboard, 
      onClick: () => { router.push('/classroom'); setOpen(false); } 
    },
    { 
      label: 'Pricing & Billing', 
      icon: CreditCard, 
      onClick: () => { router.push('/pricing'); setOpen(false); } 
    },
    { 
      label: 'Settings', 
      icon: Settings, 
      onClick: () => { onOpenSettings(); setOpen(false); } 
    },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
      >
        <div className="size-8 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-700 shadow-sm border border-white dark:border-neutral-800">
          <img src={avatar} alt={nickname} className="size-full object-cover" />
        </div>
        <ChevronDown size={14} className={cn("text-neutral-500 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-3 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30">
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Signed in as</p>
            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">{nickname || 'Learner'}</p>
          </div>
          
          <div className="p-1.5">
            {menuItems.map((item) => (
              <button
                key={item.label}
                onClick={item.onClick}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-all group"
              >
                <item.icon size={16} className="text-neutral-400 group-hover:text-emerald-500 transition-colors" />
                {item.label}
              </button>
            ))}
          </div>

          <div className="p-1.5 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/30 dark:bg-neutral-800/10">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all group"
            >
              <LogOut size={16} className="text-red-400 group-hover:text-red-500 transition-colors" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
