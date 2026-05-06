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

  const loadClassrooms = async () => {
    const list = await listStages();
    setClassrooms(list);
  };

  useEffect(() => {
    loadClassrooms();
  }, []);

  const handleCopyInvite = (id: string) => {
    const link = `${window.location.origin}/lessons/${id}`;
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
      router.push(`/lessons/${id}`);
      toast.success('Lesson created');
    } catch (error) {
      toast.error('Failed to create lesson');
    }
  };

  const handleSignOut = () => {
    clearAuthSession();
    router.push('/auth?mode=signin');
  };

  return (
    <aside 
      className={cn(
        "flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 shadow-xl",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {!collapsed && (
          <span className="font-black text-xl tracking-tight uppercase">
            AI-Tutor
          </span>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-xl hover:bg-sidebar-accent/50 transition-all text-sidebar-foreground/60 hover:text-sidebar-foreground"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Classroom List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-hide">
        <div className="flex items-center justify-between px-2 mb-4">
          {!collapsed && <span className="text-[10px] font-black text-sidebar-foreground/40 uppercase tracking-widest">Global Directory</span>}
          <button 
            onClick={() => setIsCreating(true)}
            className="p-1.5 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Plus size={16} />
          </button>
        </div>

        {isCreating && !collapsed && (
          <div className="px-2 mb-6 p-4 rounded-2xl bg-sidebar-accent/30 border border-sidebar-border/50">
            <input
              autoFocus
              value={newClassroomName}
              onChange={(e) => setNewClassroomName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateClassroom()}
              placeholder="Module Name..."
              className="w-full px-4 py-2 text-sm rounded-xl border border-sidebar-border bg-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar-primary/50 placeholder:text-white/20"
            />
            <div className="flex gap-2 mt-3">
              <button 
                onClick={handleCreateClassroom}
                className="flex-1 text-xs font-bold py-2 bg-sidebar-primary text-white rounded-lg hover:bg-emerald-600 transition-all"
              >
                Launch
              </button>
              <button 
                onClick={() => setIsCreating(false)}
                className="flex-1 text-xs font-bold py-2 bg-white/5 text-white/60 rounded-lg hover:bg-white/10 transition-all"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {classrooms.map((cls) => (
          <div key={cls.id} className="relative group">
            <Link
              href={`/lessons/${cls.id}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                currentStageId === cls.id 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-white/5" 
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <div className={cn(
                "size-8 rounded-lg flex items-center justify-center font-black text-[10px] shrink-0 shadow-sm",
                currentStageId === cls.id ? "bg-sidebar-primary text-white" : "bg-white/5 text-white/40"
              )}>
                {cls.name.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold truncate leading-tight">{cls.name}</span>
                    {cls.isDefault && <Lock size={10} className="text-sidebar-primary" />}
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-wider opacity-40 truncate mt-0.5">
                    {cls.sceneCount} Modules
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
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-sidebar-primary hover:text-white rounded-lg transition-all text-sidebar-primary z-10"
                title="Collaborate"
              >
                <UserPlus size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border/50 space-y-1">
        <Link 
          href="/operator"
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
        >
          <Settings size={18} className="opacity-70" />
          {!collapsed && <span className="text-sm font-medium">Operatoristration</span>}
        </Link>
        <button 
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-all"
        >
          <LogOut size={18} className="opacity-70" />
          {!collapsed && <span className="text-sm font-medium">Terminate Session</span>}
        </button>
      </div>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite to {invitingClassroom?.name}</DialogTitle>
            <DialogDescription>
              Share this link to invite others to see this lesson.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 py-4">
            <div className="grid flex-1 gap-2">
              <Input
                readOnly
                value={invitingClassroom ? `${window.location.origin}/lessons/${invitingClassroom.id}` : ''}
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
