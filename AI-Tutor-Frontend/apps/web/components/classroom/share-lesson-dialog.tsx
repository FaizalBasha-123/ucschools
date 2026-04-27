'use client';

import { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Loader2, Share2, Copy, Check } from 'lucide-react';
import { listStages, createStage, type StageListItem } from '@/lib/utils/stage-storage';
import { db } from '@/lib/utils/database';
import { toast } from 'sonner';

interface ShareLessonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sceneId: string;
  sceneTitle: string;
  currentStageId: string;
}

export function ShareLessonDialog({ 
  open, 
  onOpenChange, 
  sceneId, 
  sceneTitle,
  currentStageId 
}: ShareLessonDialogProps) {
  const [loading, setLoading] = useState(false);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [targetStageId, setTargetStageId] = useState<string>('');
  const [newClassroomName, setNewClassroomName] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isDefaultOnly = classrooms.length === 1 && classrooms[0].isDefault;

  useEffect(() => {
    if (open) {
      loadClassrooms();
      setShareLink(null);
      setCopied(false);
    }
  }, [open]);

  const loadClassrooms = async () => {
    const list = await listStages();
    setClassrooms(list);
    // Auto-select first non-default classroom if available
    const nonDefault = list.find(c => !c.isDefault);
    if (nonDefault) {
      setTargetStageId(nonDefault.id);
    }
  };

  const handleShare = async () => {
    setLoading(true);
    try {
      let finalStageId = targetStageId;

      if (isDefaultOnly || targetStageId === 'new') {
        if (!newClassroomName.trim()) {
          toast.error('Please enter a classroom name');
          setLoading(false);
          return;
        }
        finalStageId = await createStage(newClassroomName);
      }

      if (!finalStageId) {
        throw new Error('No target classroom selected');
      }

      // Move the scene to the target stage in local DB
      await db.scenes.update(sceneId, { stageId: finalStageId });
      
      // FETCH the updated stage data (stage + all its scenes)
      const stage = await db.stages.get(finalStageId);
      const scenes = await db.scenes.where('stageId').equals(finalStageId).toArray();

      if (!stage) throw new Error('Stage not found');

      // SYNC to server so others can view it via the share link
      const syncRes = await fetch('/api/classroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, scenes }),
      });

      if (!syncRes.ok) {
        throw new Error('Failed to sync shared classroom to server');
      }

      const syncData = await syncRes.json();
      setShareLink(syncData.data.url);
      
      toast.success('Lesson moved and shared!');
    } catch (error) {
      console.error('Share failed:', error);
      toast.error('Failed to share lesson');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Lesson</DialogTitle>
          <DialogDescription>
            {shareLink 
              ? 'Your lesson is ready to be shared!' 
              : `To share "${sceneTitle}", it needs to be moved to a sharable classroom.`}
          </DialogDescription>
        </DialogHeader>

        {!shareLink ? (
          <div className="space-y-4 py-4">
            {isDefaultOnly ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">New Classroom Name</label>
                <Input 
                  placeholder="e.g. My Shared Lessons" 
                  value={newClassroomName}
                  onChange={(e) => setNewClassroomName(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-neutral-500">
                  Default classrooms cannot be shared. A new classroom will be created for this lesson.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Classroom</label>
                  <Select value={targetStageId} onValueChange={setTargetStageId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a classroom" />
                    </SelectTrigger>
                    <SelectContent>
                      {classrooms.filter(c => !c.isDefault).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                      <SelectItem value="new">+ Create New Classroom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {targetStageId === 'new' && (
                  <div className="space-y-2 animate-in slide-in-from-top-2">
                    <label className="text-sm font-medium">New Classroom Name</label>
                    <Input 
                      placeholder="Enter classroom name..." 
                      value={newClassroomName}
                      onChange={(e) => setNewClassroomName(e.target.value)}
                    />
                  </div>
                )}
                
                <p className="text-xs text-neutral-500 italic">
                  Note: Moving this lesson will remove it from your current classroom.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-2 p-3 bg-neutral-50 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
              <Input 
                readOnly 
                value={shareLink} 
                className="border-0 bg-transparent focus-visible:ring-0 h-auto p-0 text-sm"
              />
              <Button size="sm" variant="ghost" onClick={copyToClipboard} className="shrink-0">
                {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
              </Button>
            </div>
            <p className="text-center text-xs text-neutral-500">
              Anyone with this link can view the classroom and all lessons within it.
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-end gap-2">
          {!shareLink ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button 
                onClick={handleShare} 
                disabled={loading}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Share
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} className="w-full">Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
