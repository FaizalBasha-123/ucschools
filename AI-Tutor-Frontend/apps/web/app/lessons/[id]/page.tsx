import { getJob, getLesson } from "../../../lib/api";
import { LessonPlayerShell } from "../../../components/lesson-player-shell";

type LessonPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ job?: string }>;
};

export default async function LessonPage({
  params,
  searchParams,
}: LessonPageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : undefined;
  const lesson = await getLesson(id);
  const job = search?.job ? await getJob(search.job).catch(() => null) : null;

  return (
    <LessonPlayerShell
      lesson={lesson}
      jobStatus={
        job
          ? {
              id: job.id,
              status: job.status,
              step: job.step,
              message: job.message,
            }
          : null
      }
    />
  );
}
