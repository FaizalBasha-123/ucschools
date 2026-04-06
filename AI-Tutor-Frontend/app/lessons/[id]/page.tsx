import { getLesson } from '@/lib/api';
import { StagePlayer } from '@/components/stage-player';

type LessonPageProps = {
  params: Promise<{ id: string }>;
};

export default async function LessonPage({ params }: LessonPageProps) {
  const { id } = await params;
  const lesson = await getLesson(id);

  return <StagePlayer lesson={lesson} />;
}
