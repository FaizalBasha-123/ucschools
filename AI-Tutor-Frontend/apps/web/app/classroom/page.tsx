'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getAuthSession, verifyAuthSession } from '@/lib/auth/session';
import { listStages, createStage } from '@/lib/utils/stage-storage';
import { toast } from 'sonner';

export default function ClassroomsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initClassroom() {
      try {
        const isVerified = await verifyAuthSession();
        if (!isVerified) {
          router.replace('/auth?mode=signin&next=/classroom');
          return;
        }

        const stages = await listStages();
        
        // Find or create default classroom
        let defaultClassroom = stages.find(s => s.isDefault || s.name === 'Default Classroom');
        
        if (!defaultClassroom && stages.length === 0) {
          // Create the default classroom if no classrooms exist
          const newId = await createStage('Default Classroom', true);
          router.replace(`/classroom/${newId}`);
        } else if (defaultClassroom) {
          router.replace(`/classroom/${defaultClassroom.id}`);
        } else if (stages.length > 0) {
          // If no "default" found but classrooms exist, go to the first one
          router.replace(`/classroom/${stages[0].id}`);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to initialize classroom:', error);
        toast.error('Failed to load classrooms');
        setLoading(false);
      }
    }

    initClassroom();
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-neutral-500">Entering your classroom...</p>
      </div>
    </div>
  );
}
