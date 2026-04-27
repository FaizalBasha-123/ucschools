'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Plus, 
  LayoutDashboard, 
  Settings, 
  LogOut, 
  ChevronLeft, 
  ChevronRight,
  Share2,
  MoreVertical,
  Users,
  Lock,
  MessageSquare,
  UserPlus,
  Copy,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listStages, createStage, type StageListItem } from '@/lib/utils/stage-storage';
import { clearAuthSession } from '@/lib/auth/session';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ClassroomSidebarProps {
  currentStageId?: string;
}

export function ClassroomSidebar({ currentStageId }: ClassroomSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newClassroomName, setNewClassroomName] = useState('');
  
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [invitingClassroom, setInvitingClassroom] = useState<StageListItem | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadClassrooms();
  }, []);

  const loadClassrooms = async () => {
    const list = await listStages();
    setClassrooms(list);
  };

  const handleCopyInvite = (id: string) => {
    const link = `${window.location.origin}/classroom/${id}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Invite link copied');
  };

  const handleCreateClassroom = async () => {
    if (!newClassroomName.trim()) return;
    try {
      const id = await createStage(newClassroomName);
      setNewClassroomName('');
      setIsCreating(false);
      await loadClassrooms();
      router.push(`/classroom/${id}`);
      toast.success('Classroom created');
    } catch (error) {
      toast.error('Failed to create classroom');
    }
  };

  const handleSignOut = () => {
    clearAuthSession();
    router.push('/auth?mode=signin');
  };

  return (
    <aside 
      className={cn(
        "flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {!collapsed && (
          <span className="font-bold text-lg bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
            AI-Tutor
          </span>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Classroom List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-hide">
        <div className="flex items-center justify-between px-2 mb-2">
          {!collapsed && <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Classrooms</span>}
          <button 
            onClick={() => setIsCreating(true)}
            className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
          >
            <Plus size={16} />
          </button>
        </div>

        {isCreating && !collapsed && (
          <div className="px-2 mb-4">
            <input
              autoFocus
              value={newClassroomName}
              onChange={(e) => setNewClassroomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateClassroom()}
              placeholder="Classroom name..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <div className="flex gap-2 mt-2">
              <button 
                onClick={handleCreateClassroom}
                className="flex-1 text-xs py-1.5 bg-emerald-500 text-white rounded-md hover:bg-emerald-600"
              >
                Create
              </button>
              <button 
                onClick={() => setIsCreating(false)}
                className="flex-1 text-xs py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-md"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {classrooms.map((cls) => (
          <div key={cls.id} className="relative group">
            <Link
              href={`/classroom/${cls.id}`}
              className={cn(
                "flex items-center gap-3 px-2 py-2.5 rounded-xl transition-all",
                currentStageId === cls.id 
                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/5" 
                  : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              )}
            >
              <div className={cn(
                "size-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 shadow-sm",
                currentStageId === cls.id ? "bg-emerald-500 text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400"
              )}>
                {cls.name.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate">{cls.name}</span>
                    {cls.isDefault && <Lock size={10} className="text-neutral-300" />}
                  </div>
                  <div className="text-[10px] opacity-60 truncate">
                    {cls.sceneCount} lessons
                  </div>
                </div>
              )}
            </Link>
            
            {!collapsed && !cls.isDefault && (
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInvitingClassroom(cls);
                  setInviteDialogOpen(true);
                }}
                className="absolute right-2 top-1/2 -tranneutral-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-md transition-all text-emerald-600 z-10"
                title="Invite to classroom"
              >
                <UserPlus size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-1">
        <Link 
          href="/operator"
          className="flex items-center gap-3 px-2 py-2 rounded-lg text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          <Settings size={18} />
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </Link>
        <button 
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
        >
          <LogOut size={18} />
          {!collapsed && <span className="text-sm font-medium">Sign out</span>}
        </button>
      </div>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite to {invitingClassroom?.name}</DialogTitle>
            <DialogDescription>
              Share this link to invite others to see the lessons in this classroom.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <div className="grid flex-1 gap-2">
              <Input
                readOnly
                value={invitingClassroom ? `${window.location.origin}/classroom/${invitingClassroom.id}` : ''}
                className="h-9"
              />
            </div>
            <Button size="sm" className="px-3" onClick={() => invitingClassroom && handleCopyInvite(invitingClassroom.id)}>
              <span className="sr-only">Copy</span>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter className="sm:justify-start">
            <Button type="button" variant="secondary" onClick={() => setInviteDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
