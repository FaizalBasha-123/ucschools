"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Edit, FileText, GraduationCap, Loader2, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface SubjectOption {
  subject_id: string;
  subject_name: string;
}

interface CatalogClass {
  id: string;
  name: string;
  sort_order: number;
}

interface CatalogSubject {
  id: string;
  name: string;
  code?: string;
}

interface AssignmentItem {
  class: CatalogClass;
  subjects: CatalogSubject[];
}

interface ClassOption {
  class_id: string;
  class_name: string;
  class_level: string;
  subjects: SubjectOption[];
}

interface QuizItem {
  id: string;
  title: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  chapter_name?: string;
  scheduled_at: string;
  is_anytime: boolean;
  duration_minutes: number;
  total_marks: number;
  question_count: number;
  status: "upcoming" | "active" | "completed";
}

interface QuizChapter {
  id: string;
  class_id: string;
  subject_id: string;
  chapter_name: string;
  chapter_source?: string;
  can_edit?: boolean;
}

interface FormOption {
  option_text: string;
  is_correct: boolean;
}

interface FormQuestion {
  question_text: string;
  marks: number;
  options: FormOption[];
}

function defaultQuestion(): FormQuestion {
  return {
    question_text: "",
    marks: 1,
    options: [
      { option_text: "", is_correct: true },
      { option_text: "", is_correct: false },
    ],
  };
}

export default function SuperAdminQuizSchedulerPage() {
  const queryClient = useQueryClient();

  const [openCreate, setOpenCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [classFilter, setClassFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");

  const [title, setTitle] = useState("");
  const [classID, setClassID] = useState("");
  const [subjectID, setSubjectID] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [isAnytime, setIsAnytime] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [totalMarks, setTotalMarks] = useState("0");
  const [questions, setQuestions] = useState<FormQuestion[]>([defaultQuestion()]);

  const [openManagedChapters, setOpenManagedChapters] = useState(false);
  const [managedChapterClassID, setManagedChapterClassID] = useState("");
  const [managedChapterSubjectID, setManagedChapterSubjectID] = useState("");
  const [managedChapterName, setManagedChapterName] = useState("");
  const [managedEditChapterID, setManagedEditChapterID] = useState<string | null>(null);

  const [openEdit, setOpenEdit] = useState(false);
  const [editQuiz, setEditQuiz] = useState<QuizItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editIsAnytime, setEditIsAnytime] = useState(false);
  const [editScheduledDate, setEditScheduledDate] = useState("");
  const [editScheduledTime, setEditScheduledTime] = useState("09:00");
  const [editDuration, setEditDuration] = useState("30");

  const [deleteQuizId, setDeleteQuizId] = useState<string | null>(null);

  const [openAddQ, setOpenAddQ] = useState(false);
  const [addQQuizId, setAddQQuizId] = useState<string | null>(null);
  const [addQQuestion, setAddQQuestion] = useState("");
  const [addQMarks, setAddQMarks] = useState(1);
  const [addQOptions, setAddQOptions] = useState<FormOption[]>([
    { option_text: "", is_correct: true },
    { option_text: "", is_correct: false },
  ]);

  const resetAddQ = () => {
    setAddQQuestion("");
    setAddQMarks(1);
    setAddQOptions([
      { option_text: "", is_correct: true },
      { option_text: "", is_correct: false },
    ]);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const classesQuery = useQuery({
    queryKey: ["super-admin-catalog-classes", "quiz-scheduler"],
    queryFn: () => api.get<{ classes: CatalogClass[] }>("/super-admin/catalog/classes"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const assignmentsQuery = useQuery({
    queryKey: ["super-admin-catalog-assignments", "quiz-scheduler"],
    queryFn: () => api.get<{ assignments: AssignmentItem[] }>("/super-admin/catalog/assignments"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const subjectsQuery = useQuery({
    queryKey: ["super-admin-catalog-subjects", "quiz-scheduler"],
    queryFn: () => api.get<{ subjects: CatalogSubject[] }>("/super-admin/catalog/subjects"),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const quizzesQuery = useInfiniteQuery({
    queryKey: ["super-admin-quizzes", classFilter, subjectFilter, debouncedSearch],
    queryFn: ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      params.set("page", String(pageParam));
      params.set("page_size", "50");
      if (classFilter !== "all") params.set("class_id", classFilter);
      if (subjectFilter !== "all") params.set("subject_id", subjectFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return api.get<{ quizzes: QuizItem[]; has_more: boolean; next_page: number }>(`/super-admin/quizzes?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_page : undefined,
    initialPageParam: 1,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const onScroll = () => {
      if (!quizzesQuery.hasNextPage || quizzesQuery.isFetchingNextPage) return;
      const el = document.documentElement;
      const viewportBottom = (window.scrollY || el.scrollTop) + window.innerHeight;
      if (viewportBottom >= el.scrollHeight * 0.8) quizzesQuery.fetchNextPage();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [quizzesQuery.hasNextPage, quizzesQuery.isFetchingNextPage, quizzesQuery.fetchNextPage]);

  const classOptions = useMemo<ClassOption[]>(() => {
    const classes = classesQuery.data?.classes || [];
    const assignments = assignmentsQuery.data?.assignments || [];

    const subjects = subjectsQuery.data?.subjects || [];
    const subjectMap = new Map<string, CatalogSubject>();
    for (const subject of subjects) {
      subjectMap.set(subject.id, subject);
    }

    const subjectsByClass = new Map<string, SubjectOption[]>();
    for (const assignment of assignments) {
      const mergedSubjects: SubjectOption[] = [];
      const seen = new Set<string>();
      for (const subject of assignment.subjects || []) {
        const resolved = subjectMap.get(subject.id) || subject;
        if (seen.has(resolved.id)) continue;
        seen.add(resolved.id);
        mergedSubjects.push({
          subject_id: resolved.id,
          subject_name: resolved.name,
        });
      }
      mergedSubjects.sort((a, b) => a.subject_name.localeCompare(b.subject_name));
      subjectsByClass.set(
        assignment.class.id,
        mergedSubjects,
      );
    }

    return [...classes]
      .sort((a, b) => {
        if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
          return (a.sort_order ?? 0) - (b.sort_order ?? 0);
        }
        return a.name.localeCompare(b.name);
      })
      .map((catalogClass) => ({
        class_id: catalogClass.id,
        class_name: catalogClass.name,
        class_level: catalogClass.name,
        subjects: subjectsByClass.get(catalogClass.id) || [],
      }));
  }, [classesQuery.data?.classes, assignmentsQuery.data?.assignments, subjectsQuery.data?.subjects]);
  const selectedClass = useMemo(() => classOptions.find((c) => c.class_id === classID) || null, [classOptions, classID]);
  const subjectOptions = selectedClass?.subjects || [];
  const managedSelectedClass = useMemo(
    () => classOptions.find((c) => c.class_id === managedChapterClassID) || null,
    [classOptions, managedChapterClassID],
  );
  const managedSubjectOptions = managedSelectedClass?.subjects || [];
  const selectedFilterClass = useMemo(() => classOptions.find((c) => c.class_id === classFilter) || null, [classOptions, classFilter]);
  const subjectFilterOptions = selectedFilterClass?.subjects || [];
  const quizzes = useMemo(() => quizzesQuery.data?.pages.flatMap(p => p.quizzes) || [], [quizzesQuery.data]);

  const stats = useMemo(() => {
    const upcoming = quizzes.filter((q) => q.status === "upcoming").length;
    const active = quizzes.filter((q) => q.status === "active").length;
    const completed = quizzes.filter((q) => q.status === "completed").length;
    return { upcoming, active, completed, total: quizzes.length };
  }, [quizzes]);

  const createChapterOptionsQuery = useQuery({
    queryKey: ["super-admin-quiz-chapters", "create", classID, subjectID],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("class_id", classID);
      params.set("subject_id", subjectID);
      return api.get<{ chapters: QuizChapter[] }>(`/super-admin/quizzes/chapters?${params.toString()}`);
    },
    enabled: openCreate && !!classID && !!subjectID,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const managedChapterQuery = useQuery({
    queryKey: ["super-admin-quiz-chapters", "manage", managedChapterClassID, managedChapterSubjectID],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("class_id", managedChapterClassID);
      params.set("subject_id", managedChapterSubjectID);
      return api.get<{ chapters: QuizChapter[] }>(`/super-admin/quizzes/chapters?${params.toString()}`);
    },
    enabled: openManagedChapters && !!managedChapterClassID && !!managedChapterSubjectID,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const resetForm = () => {
    setTitle("");
    setClassID("");
    setSubjectID("");
    setChapterName("");
    setIsAnytime(false);
    setScheduledDate("");
    setScheduledTime("09:00");
    setDurationMinutes("30");
    setTotalMarks("0");
    setQuestions([defaultQuestion()]);
  };

  const resetManagedChapterForm = () => {
    setManagedChapterName("");
    setManagedEditChapterID(null);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Quiz title is required");
      if (!classID) throw new Error("Class is required");
      if (!subjectID) throw new Error("Subject is required");
      if (!chapterName.trim()) throw new Error("Chapter is required");
      if (!isAnytime && !scheduledDate) throw new Error("Date is required");
      if (!isAnytime && !scheduledTime) throw new Error("Time is required");
      if (questions.length === 0) throw new Error("Add at least one question");

      return api.post<{ id: string; message: string }>("/super-admin/quizzes", {
        title: title.trim(),
        class_id: classID,
        subject_id: subjectID,
        chapter_name: chapterName.trim(),
        is_anytime: isAnytime,
        scheduled_at: isAnytime ? "" : `${scheduledDate}T${scheduledTime}:00Z`,
        duration_minutes: Number(durationMinutes || 30),
        total_marks: Number(totalMarks || 0),
        questions: questions.map((q) => ({
          question_text: q.question_text.trim(),
          marks: Number(q.marks || 1),
          options: q.options.map((o) => ({ option_text: o.option_text.trim(), is_correct: !!o.is_correct })),
        })),
      });
    },
    onSuccess: () => {
      toast.success("Quiz created");
      setOpenCreate(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to create quiz", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const updateQuizMutation = useMutation({
    mutationFn: (payload: { id: string; title: string; scheduled_at: string; is_anytime: boolean; duration_minutes: number }) =>
      api.put(`/super-admin/quizzes/${payload.id}`, {
        title: payload.title,
        scheduled_at: payload.scheduled_at,
        is_anytime: payload.is_anytime,
        duration_minutes: payload.duration_minutes,
      }),
    onSuccess: () => {
      toast.success("Quiz updated");
      setOpenEdit(false);
      setEditQuiz(null);
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update quiz", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const deleteQuizMutation = useMutation({
    mutationFn: (quizId: string) => api.delete(`/super-admin/quizzes/${quizId}`),
    onSuccess: () => {
      toast.success("Quiz deleted");
      setDeleteQuizId(null);
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to delete quiz", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const addQuestionMutation = useMutation({
    mutationFn: () => {
      if (!addQQuizId) throw new Error("No quiz selected");
      if (!addQQuestion.trim()) throw new Error("Question text required");
      if (addQOptions.length < 2) throw new Error("At least 2 options needed");
      if (!addQOptions.some((o) => o.is_correct)) throw new Error("Mark one option as correct");
      return api.post(`/super-admin/quizzes/${addQQuizId}/questions`, {
        question_text: addQQuestion.trim(),
        marks: addQMarks,
        options: addQOptions.map((o) => ({ option_text: o.option_text.trim(), is_correct: o.is_correct })),
      });
    },
    onSuccess: () => {
      toast.success("Question added");
      setOpenAddQ(false);
      resetAddQ();
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to add question", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const createManagedChapterMutation = useMutation({
    mutationFn: async () => {
      if (!managedChapterClassID) throw new Error("Class is required");
      if (!managedChapterSubjectID) throw new Error("Subject is required");
      if (!managedChapterName.trim()) throw new Error("Chapter name is required");
      return api.post<{ chapter: QuizChapter }>("/super-admin/quizzes/chapters", {
        class_id: managedChapterClassID,
        subject_id: managedChapterSubjectID,
        chapter_name: managedChapterName.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Chapter saved");
      resetManagedChapterForm();
      queryClient.invalidateQueries({ queryKey: ["super-admin-quiz-chapters"] });
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to save chapter", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const updateManagedChapterMutation = useMutation({
    mutationFn: async () => {
      if (!managedEditChapterID) throw new Error("Chapter not selected");
      if (!managedChapterName.trim()) throw new Error("Chapter name is required");
      return api.put<{ chapter: QuizChapter }>(`/super-admin/quizzes/chapters/${managedEditChapterID}`, {
        chapter_name: managedChapterName.trim(),
      });
    },
    onSuccess: () => {
      toast.success("Chapter updated");
      resetManagedChapterForm();
      queryClient.invalidateQueries({ queryKey: ["super-admin-quiz-chapters"] });
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to update chapter", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const deleteManagedChapterMutation = useMutation({
    mutationFn: (chapterID: string) => api.delete(`/super-admin/quizzes/chapters/${chapterID}`),
    onSuccess: () => {
      toast.success("Chapter deleted");
      resetManagedChapterForm();
      queryClient.invalidateQueries({ queryKey: ["super-admin-quiz-chapters"] });
      queryClient.invalidateQueries({ queryKey: ["super-admin-quizzes"] });
    },
    onError: (error: unknown) => {
      toast.error("Failed to delete chapter", {
        description: error instanceof Error ? error.message : "Unexpected error",
      });
    },
  });

  const addQuestion = () => {
    setQuestions((prev) => [...prev, defaultQuestion()]);
  };

  const removeQuestion = (qIdx: number) => {
    setQuestions((prev) => prev.filter((_, idx) => idx !== qIdx));
  };

  const updateQuestionText = (qIdx: number, value: string) => {
    setQuestions((prev) => prev.map((q, idx) => (idx === qIdx ? { ...q, question_text: value } : q)));
  };

  const updateQuestionMarks = (qIdx: number, value: number) => {
    setQuestions((prev) => prev.map((q, idx) => (idx === qIdx ? { ...q, marks: value } : q)));
  };

  const addOption = (qIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === qIdx ? { ...q, options: [...q.options, { option_text: "", is_correct: false }] } : q)),
    );
  };

  const removeOption = (qIdx: number, oIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        const nextOptions = q.options.filter((_, optionIdx) => optionIdx !== oIdx);
        if (!nextOptions.some((o) => o.is_correct) && nextOptions.length > 0) {
          nextOptions[0].is_correct = true;
        }
        return { ...q, options: nextOptions };
      }),
    );
  };

  const updateOptionText = (qIdx: number, oIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, optionIdx) => (optionIdx === oIdx ? { ...o, option_text: value } : o)),
        };
      }),
    );
  };

  const setCorrectOption = (qIdx: number, oIdx: number) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIdx) return q;
        return {
          ...q,
          options: q.options.map((o, optionIdx) => ({ ...o, is_correct: optionIdx === oIdx })),
        };
      }),
    );
  };

  const chapterOptions = useMemo(
    () => createChapterOptionsQuery.data?.chapters || [],
    [createChapterOptionsQuery.data?.chapters],
  );

  const managedChapters = useMemo(
    () => managedChapterQuery.data?.chapters || [],
    [managedChapterQuery.data?.chapters],
  );

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Quiz Engine</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base">Orchestrate and schedule assessments globally across all classes and subjects</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={openManagedChapters} onOpenChange={(v) => {
            setOpenManagedChapters(v);
            if (!v) {
              setManagedChapterClassID("");
              setManagedChapterSubjectID("");
              resetManagedChapterForm();
            }
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="bg-card border-border hover:bg-muted text-foreground shadow-sm h-10 px-4 rounded-xl transition-all">
                <FileText className="h-4 w-4 mr-2 text-indigo-500" />
                Manage Chapters
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl p-0 overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl sm:rounded-2xl">
              <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/50">
                <DialogTitle className="text-xl font-bold flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-500" /> Curriculum Manager
                </DialogTitle>
                <DialogDescription>Add, update, or remove subjects and chapters available for quizzes.</DialogDescription>
              </DialogHeader>
              <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto w-full">

                {/* Selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-muted/50 border border-border">
                  <div className="grid gap-2">
                    <Label className="text-slate-700 dark:text-slate-300 text-xs font-semibold uppercase tracking-wide">Select Class Level</Label>
                    <Select value={managedChapterClassID} onValueChange={(value) => { setManagedChapterClassID(value); setManagedChapterSubjectID(""); resetManagedChapterForm(); }}>
                      <SelectTrigger className="h-11 bg-card border-border rounded-lg shadow-sm"><SelectValue placeholder="Choose a class..." /></SelectTrigger>
                      <SelectContent>
                        {classOptions.map((c) => (
                          <SelectItem key={c.class_id} value={c.class_id}>{c.class_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-slate-700 dark:text-slate-300 text-xs font-semibold uppercase tracking-wide">Select Subject</Label>
                    <Select
                      value={managedChapterSubjectID}
                      onValueChange={(value) => { setManagedChapterSubjectID(value); resetManagedChapterForm(); }}
                      disabled={!managedChapterClassID || managedSubjectOptions.length === 0}
                    >
                      <SelectTrigger className="h-11 bg-card border-border rounded-lg shadow-sm"><SelectValue placeholder={managedChapterClassID ? "Choose a subject..." : "Select class first"} /></SelectTrigger>
                      <SelectContent>
                        {managedSubjectOptions.map((s) => (
                          <SelectItem key={s.subject_id} value={s.subject_id}>{s.subject_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-end gap-3">
                  <div className="grid gap-2 flex-1 w-full">
                    <Label className="text-slate-700 dark:text-slate-300 font-medium">Chapter Title</Label>
                    <Input
                      value={managedChapterName}
                      onChange={(e) => setManagedChapterName(e.target.value)}
                      placeholder="e.g. Introduction to Calculus"
                      disabled={!managedChapterClassID || !managedChapterSubjectID}
                      className="h-11 bg-muted/50 rounded-xl"
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    {managedEditChapterID ? (
                      <Button className="h-11 px-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl shadow-md w-full sm:w-auto" disabled={updateManagedChapterMutation.isPending} onClick={() => updateManagedChapterMutation.mutate()}>
                        {updateManagedChapterMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Target"}
                      </Button>
                    ) : (
                      <Button className="h-11 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-md w-full sm:w-auto" disabled={createManagedChapterMutation.isPending || !managedChapterClassID || !managedChapterSubjectID || !managedChapterName} onClick={() => createManagedChapterMutation.mutate()}>
                        {createManagedChapterMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Entry"}
                      </Button>
                    )}
                    {managedEditChapterID ? (
                      <Button
                        variant="outline"
                        className="h-11 rounded-xl w-full sm:w-auto"
                        onClick={resetManagedChapterForm}
                        disabled={createManagedChapterMutation.isPending || updateManagedChapterMutation.isPending}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <Label className="text-slate-700 dark:text-slate-300 font-medium flex items-center justify-between">
                    <span>Configured Chapters</span>
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">
                      {managedChapters.length} Total
                    </Badge>
                  </Label>
                  <div className="min-h-[200px] max-h-[300px] overflow-y-auto border border-border/60 rounded-xl bg-muted/30 p-2">
                    {!managedChapterClassID || !managedChapterSubjectID ? (
                      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                        <FileText className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-3" />
                        <p className="text-sm text-slate-500 font-medium">Select a class and subject above to view chapters.</p>
                      </div>
                    ) : managedChapterQuery.isLoading ? (
                      <div className="flex flex-col items-center justify-center h-full py-12">
                        <Loader2 className="h-6 w-6 text-indigo-500 animate-spin mb-3" />
                        <p className="text-sm text-slate-500 font-medium animate-pulse">Loading curriculum data...</p>
                      </div>
                    ) : managedChapters.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                        <GraduationCap className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-3" />
                        <p className="text-sm text-slate-500 font-medium">No chapters configured for this subject yet.</p>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {managedChapters.map((chapter) => (
                          <div key={chapter.id} className="group flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 hover:shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700/50 transition-all">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{chapter.chapter_name}</span>
                            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                                onClick={() => {
                                  setManagedEditChapterID(chapter.id);
                                  setManagedChapterName(chapter.chapter_name);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                                onClick={() => deleteManagedChapterMutation.mutate(chapter.id)}
                                disabled={deleteManagedChapterMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 h-10 px-4 rounded-xl font-medium transition-all">
                <Plus className="mr-2 h-4 w-4" />
                Create Quiz
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl sm:rounded-2xl">
              <div className="flex flex-col h-full max-h-[90vh]">
                <DialogHeader className="p-6 pb-4 border-b border-border shrink-0">
                  <DialogTitle className="text-xl md:text-2xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                    <GraduationCap className="h-6 w-6 text-indigo-500" /> Assessment Creator
                  </DialogTitle>
                  <DialogDescription className="text-slate-500">Configure quiz metadata, schedule settings, and question bank.</DialogDescription>
                </DialogHeader>
                <div className="p-6 overflow-y-auto space-y-8 flex-1">

                  {/* Basic Info Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <div className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-xs font-bold text-indigo-600 dark:text-indigo-400">1</div>
                      <h3 className="font-semibold">Basic Information</h3>
                    </div>
                    <div className="grid gap-3">
                      <Label className="text-slate-700 dark:text-slate-300">Quiz Title</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mid-Term Geometry Exam" className="h-11 bg-muted/50 rounded-xl" />
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                      <div className="grid gap-3">
                        <Label className="text-slate-700 dark:text-slate-300">Class Level</Label>
                        <Select value={classID} onValueChange={(value) => { setClassID(value); setSubjectID(""); setChapterName(""); }}>
                          <SelectTrigger className="h-11 bg-muted/50 rounded-xl"><SelectValue placeholder="Select class" /></SelectTrigger>
                          <SelectContent>
                            {classOptions.map((c) => <SelectItem key={c.class_id} value={c.class_id}>{c.class_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-3">
                        <Label className="text-slate-700 dark:text-slate-300">Subject</Label>
                        <Select value={subjectID} onValueChange={(value) => { setSubjectID(value); setChapterName(""); }} disabled={!classID || subjectOptions.length === 0}>
                          <SelectTrigger className="h-11 bg-muted/50 rounded-xl"><SelectValue placeholder={classID ? "Select subject" : "Select class first"} /></SelectTrigger>
                          <SelectContent>
                            {subjectOptions.map((s) => <SelectItem key={s.subject_id} value={s.subject_id}>{s.subject_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-3">
                        <Label className="text-slate-700 dark:text-slate-300">Chapter / Topic</Label>
                        <Select value={chapterName} onValueChange={setChapterName} disabled={!classID || !subjectID || createChapterOptionsQuery.isLoading || chapterOptions.length === 0}>
                          <SelectTrigger className="h-11 bg-muted/50 rounded-xl">
                            <SelectValue placeholder={!classID || !subjectID ? "Select class/subject" : createChapterOptionsQuery.isLoading ? "Loading chapters..." : chapterOptions.length === 0 ? "No chapters match" : "Select chapter"} />
                          </SelectTrigger>
                          <SelectContent>
                            {chapterOptions.map((chapter) => <SelectItem key={chapter.id} value={chapter.chapter_name}>{chapter.chapter_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* Schedule Settings */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <div className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-xs font-bold text-emerald-600 dark:text-emerald-400">2</div>
                      <h3 className="font-semibold">Schedule & Limits</h3>
                    </div>
                    <div className="bg-muted/50 p-4 rounded-xl border border-border space-y-4">
                      <div className="flex flex-row items-center justify-between p-3 rounded-lg bg-card border border-border shadow-sm cursor-pointer" onClick={() => setIsAnytime(!isAnytime)}>
                        <div className="space-y-0.5">
                          <Label className="text-sm font-semibold cursor-pointer pointer-events-none">Anytime Assessment</Label>
                          <p className="text-xs text-slate-500">Allow students to take this quiz at any time (no strict schedule).</p>
                        </div>
                        <input type="checkbox" checked={isAnytime} readOnly className="h-5 w-5 accent-indigo-600 rounded-md cursor-pointer pointer-events-none" />
                      </div>
                      <div className={`transition-all duration-300 overflow-hidden ${isAnytime ? 'max-h-0 opacity-0 m-0' : 'max-h-40 opacity-100'}`}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                          <div className="grid gap-2">
                            <Label className="text-xs text-slate-500 font-medium">Scheduled Date</Label>
                            <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} disabled={isAnytime} className="bg-card" />
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-xs text-muted-foreground font-medium">Time (UTC)</Label>
                            <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} disabled={isAnytime} className="bg-card" />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div className="grid gap-2">
                          <Label className="text-xs text-slate-500 font-medium">Duration (Minutes)</Label>
                          <div className="relative">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} className="pl-9 bg-card" />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-xs text-muted-foreground font-medium">Total Marks</Label>
                          <div className="relative">
                            <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input type="number" min={0} value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} className="pl-9 bg-card" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Questionnaire */}
                  <div className="space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-border">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400">3</div>
                        <h3 className="font-semibold">Questionnaire</h3>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addQuestion} className="h-8 text-xs rounded-full border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                        <Plus className="mr-1 h-3 w-3" /> Add Question
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {questions.map((q, qIdx) => (
                        <div key={`q-${qIdx}`} className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-sm relative group/q pt-8">
                          <div className="absolute top-0 right-0 left-0 bg-muted/80 px-3 py-1.5 flex justify-between items-center rounded-t-xl border-b border-border">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Question {qIdx + 1}</span>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors" onClick={() => removeQuestion(qIdx)} disabled={questions.length === 1} title="Remove Question">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="flex flex-col xl:flex-row gap-4 mb-4">
                            <div className="flex-1 space-y-2">
                              <Input value={q.question_text} onChange={(e) => updateQuestionText(qIdx, e.target.value)} placeholder="Type your question here..." className="font-medium bg-muted/50 border-border h-10" />
                            </div>
                            <div className="w-full md:w-28 space-y-2">
                              <div className="relative">
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">pts</span>
                                <Input type="number" min={1} value={q.marks} onChange={(e) => updateQuestionMarks(qIdx, Number(e.target.value || 1))} className="pr-8 h-10 bg-muted/50 border-border text-center" />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900 ml-2">
                            {q.options.map((opt, oIdx) => (
                              <div key={`q-${qIdx}-o-${oIdx}`} className={`flex items-center gap-2 p-2 rounded-lg transition-colors border ${opt.is_correct ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50' : 'bg-transparent border-transparent hover:bg-muted/50'}`}>
                                <div className="flex items-center justify-center shrink-0 w-8 h-8 cursor-pointer" onClick={() => setCorrectOption(qIdx, oIdx)}>
                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${opt.is_correct ? 'border-emerald-500 bg-emerald-500' : 'border-border bg-card'}`}>
                                    {opt.is_correct && <div className="w-2 h-2 rounded-full bg-white" />}
                                  </div>
                                </div>
                                <Input value={opt.option_text} onChange={(e) => updateOptionText(qIdx, oIdx, e.target.value)} placeholder={`Option ${oIdx + 1}`} className={`h-9 border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-offset-0 ${opt.is_correct ? 'font-medium text-emerald-900 dark:text-emerald-300 placeholder:text-emerald-700/50 dark:placeholder:text-emerald-500/50' : ''}`} />
                                <Button type="button" variant="ghost" size="icon" onClick={() => removeOption(qIdx, oIdx)} disabled={q.options.length <= 2} className="h-8 w-8 text-slate-400 hover:text-rose-600 opacity-0 group-hover/q:opacity-100 transition-opacity shrink-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button type="button" variant="ghost" size="sm" onClick={() => addOption(qIdx)} className="ml-8 mt-2 h-8 text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400">
                              <Plus className="mr-1 h-3 w-3" /> Add Option
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter className="p-4 border-t border-border bg-muted/50 shrink-0">
                  <div className="flex justify-end gap-2 w-full">
                    <Button variant="outline" onClick={() => setOpenCreate(false)} className="rounded-xl">Cancel</Button>
                    <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 rounded-xl">
                      {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : "Publish Assessment"}
                    </Button>
                  </div>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6">
        <Card className="border border-border/60 shadow-sm bg-card/50 backdrop-blur-xl hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center border border-amber-200 dark:border-amber-800/50">
              <Calendar className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.upcoming}</p>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Upcoming</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/60 shadow-sm bg-card/50 backdrop-blur-xl hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center border border-emerald-200 dark:border-emerald-800/50">
              <Clock className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.active}</p>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Now</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/60 shadow-sm bg-card/50 backdrop-blur-xl hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center border border-blue-200 dark:border-blue-800/50">
              <FileText className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.completed}</p>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/60 shadow-sm bg-gradient-to-br from-indigo-500/5 to-violet-500/5 dark:from-indigo-500/10 dark:to-violet-500/10 backdrop-blur-xl hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center border border-indigo-200 dark:border-indigo-800/50">
              <GraduationCap className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Quizzes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border border-border/60 shadow-sm bg-card/50 backdrop-blur-xl">
        <CardContent className="p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1 w-full xl:max-w-md group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              </div>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 bg-muted/50 border-border focus-visible:ring-indigo-500/30 rounded-xl transition-all w-full"
                placeholder="Search assessments by title, class or subject..."
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <Select value={classFilter} onValueChange={(value) => { setClassFilter(value); setSubjectFilter("all"); }}>
                <SelectTrigger className="w-full sm:w-[200px] h-11 bg-card border-border rounded-xl focus-visible:ring-indigo-500/30"><GraduationCap className="h-4 w-4 mr-2 text-slate-400" /><SelectValue placeholder="All Classes" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all" className="font-medium text-indigo-600 dark:text-indigo-400">All Classes</SelectItem>
                  {classOptions.map((opt) => <SelectItem key={opt.class_id} value={opt.class_id}>{opt.class_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={subjectFilter} onValueChange={setSubjectFilter} disabled={classFilter === "all"}>
                <SelectTrigger className="w-full sm:w-[200px] h-11 bg-card border-border rounded-xl focus-visible:ring-indigo-500/30"><FileText className="h-4 w-4 mr-2 text-slate-400" /><SelectValue placeholder={classFilter === "all" ? "Select class first" : "All Subjects"} /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all" className="font-medium text-indigo-600 dark:text-indigo-400">All Subjects</SelectItem>
                  {subjectFilterOptions.map((opt) => <SelectItem key={opt.subject_id} value={opt.subject_id}>{opt.subject_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
        {quizzesQuery.isLoading || classesQuery.isLoading || assignmentsQuery.isLoading || subjectsQuery.isLoading ? (
          <div className="md:col-span-2 lg:col-span-3 flex flex-col items-center justify-center py-20 bg-card/30 rounded-2xl border border-border/50 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-500 font-medium animate-pulse tracking-wide">Loading assessments...</p>
          </div>
        ) : quizzes.length === 0 ? (
          <div className="md:col-span-2 lg:col-span-3 flex flex-col items-center justify-center py-24 px-4 text-center bg-card/30 rounded-2xl border border-border/50 backdrop-blur-sm">
            <div className="p-6 rounded-full bg-muted mb-6 inline-flex shadow-sm">
              <FileText className="h-10 w-10 text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No Quizzes Found</h3>
            <p className="text-slate-500 max-w-sm mx-auto">Either no assessments have been scheduled yet, or none match your current filters.</p>
          </div>
        ) : (
          quizzes.map((quiz) => (
            <Card key={quiz.id} className="group relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-xl hover:shadow-xl hover:shadow-indigo-500/5 hover:border-indigo-300 dark:hover:border-indigo-700/60 transition-all duration-300">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/0 to-transparent group-hover:via-indigo-500/50 transition-all duration-500" />
              <CardHeader className="pb-4 relative">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className={`font-semibold tracking-wide uppercase text-[10px] px-2.5 py-0.5 border-0 ${quiz.status === "upcoming" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
                    quiz.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" :
                      "bg-muted text-muted-foreground"
                    }`}>{quiz.status}</Badge>
                  <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 transition-colors" onClick={() => {
                      setEditQuiz(quiz);
                      setEditTitle(quiz.title);
                      setEditIsAnytime(!!quiz.is_anytime);
                      setEditScheduledDate(quiz.scheduled_at.slice(0, 10));
                      const rawTime = new Date(quiz.scheduled_at);
                      const hh = rawTime.getUTCHours().toString().padStart(2, "0");
                      const mm = rawTime.getUTCMinutes().toString().padStart(2, "0");
                      setEditScheduledTime(`${hh}:${mm}`);
                      setEditDuration(String(quiz.duration_minutes));
                      setOpenEdit(true);
                    }}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" onClick={() => setDeleteQuizId(quiz.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <CardTitle className="text-lg font-bold text-slate-900 dark:text-white line-clamp-1" title={quiz.title}>{quiz.title}</CardTitle>
                <CardDescription className="font-medium text-slate-500 mt-1 line-clamp-1" title={`${quiz.subject_name}${quiz.chapter_name ? ` • ${quiz.chapter_name}` : ""}`}>
                  {quiz.subject_name}{quiz.chapter_name ? ` • ${quiz.chapter_name}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3 mb-6 bg-muted/50 p-4 rounded-xl border border-border/60">
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <Users className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="font-medium truncate" title={quiz.class_name}>{quiz.class_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <Calendar className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-medium truncate">{quiz.is_anytime ? "Anytime Assessment" : new Date(quiz.scheduled_at).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-1 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{quiz.duration_minutes} mins</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <FileText className="h-3.5 w-3.5" />
                      <span>{quiz.question_count} Qs • {quiz.total_marks} Pts</span>
                    </div>
                  </div>
                </div>
                <div className="pt-1">
                  <Button
                    variant={quiz.status === "completed" ? "secondary" : "default"}
                    className={`w-full font-semibold shadow-none transition-all ${quiz.status !== "completed" ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    onClick={() => { if (quiz.status === "upcoming" || quiz.status === "active") { setAddQQuizId(quiz.id); setOpenAddQ(true); } }}
                  >
                    {quiz.status === "upcoming" || quiz.status === "active" ? (
                      <><Plus className="h-4 w-4 mr-2" /> Manage Questions</>
                    ) : (
                      "View Results"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {quizzesQuery.isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      )}

      <Dialog open={openEdit} onOpenChange={(v) => { setOpenEdit(v); if (!v) setEditQuiz(null); }}>
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto p-0 border-border/60 bg-card/95 backdrop-blur-xl sm:rounded-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/50">
            <DialogTitle className="text-xl font-bold">Edit Quiz Details</DialogTitle>
            <DialogDescription>Update the title and scheduling logic for this quiz.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="grid gap-3">
              <Label className="text-slate-700 dark:text-slate-300">Title</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Quiz title" className="h-11 bg-muted/50" />
            </div>
            <div className="flex flex-row items-center justify-between p-3 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 cursor-pointer" onClick={() => setEditIsAnytime(!editIsAnytime)}>
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold cursor-pointer">Anytime Assessment</Label>
                <p className="text-xs text-slate-500">Remove time constraints.</p>
              </div>
              <input type="checkbox" checked={editIsAnytime} readOnly className="h-5 w-5 accent-amber-600 rounded-md cursor-pointer pointer-events-none" />
            </div>
            <div className={`transition-all duration-300 overflow-hidden ${editIsAnytime ? 'h-0 opacity-0 m-0' : 'h-auto opacity-100'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-xs text-slate-500 font-medium">Scheduled Date</Label>
                  <Input type="date" value={editScheduledDate} onChange={(e) => setEditScheduledDate(e.target.value)} disabled={editIsAnytime} className="bg-muted/50" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground font-medium">Time (UTC)</Label>
                  <Input type="time" value={editScheduledTime} onChange={(e) => setEditScheduledTime(e.target.value)} disabled={editIsAnytime} className="bg-muted/50" />
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs text-slate-500 font-medium">Duration (minutes)</Label>
              <div className="relative w-full sm:w-1/2">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input type="number" min={1} value={editDuration} onChange={(e) => setEditDuration(e.target.value)} className="pl-9 bg-muted/50" />
              </div>
            </div>
          </div>
          <DialogFooter className="p-4 border-t border-border bg-muted/50">
            <Button variant="outline" onClick={() => setOpenEdit(false)} className="rounded-xl">Cancel</Button>
            <Button className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 rounded-xl" disabled={updateQuizMutation.isPending} onClick={() => {
              if (!editQuiz) return;
              updateQuizMutation.mutate({
                id: editQuiz.id,
                title: editTitle,
                scheduled_at: editIsAnytime ? "" : (editScheduledDate ? `${editScheduledDate}T${editScheduledTime || "09:00"}:00Z` : ""),
                is_anytime: editIsAnytime,
                duration_minutes: Number(editDuration) || 30,
              });
            }}>
              {updateQuizMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteQuizId} onOpenChange={(v) => { if (!v) setDeleteQuizId(null); }}>
        <DialogContent className="w-[95vw] max-w-sm max-h-[90vh] overflow-y-auto p-0 border-border/60 bg-card/95 backdrop-blur-xl sm:rounded-2xl">
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
              <Trash2 className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-slate-900 dark:text-white mb-2">Delete Assessment?</DialogTitle>
              <DialogDescription className="text-slate-500">
                This will permanently delete the selected quiz, including all its scheduled settings and internal question bank. This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 bg-muted/50 border-t border-border flex justify-between gap-3 w-full">
            <Button variant="outline" onClick={() => setDeleteQuizId(null)} className="flex-1 rounded-xl bg-card border-border">Cancel</Button>
            <Button variant="destructive" className="flex-1 rounded-xl shadow-md shadow-rose-500/20" disabled={deleteQuizMutation.isPending} onClick={() => { if (deleteQuizId) deleteQuizMutation.mutate(deleteQuizId); }}>
              {deleteQuizMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openAddQ} onOpenChange={(v) => { setOpenAddQ(v); if (!v) { resetAddQ(); setAddQQuizId(null); } }}>
        <DialogContent className="w-[95vw] max-w-xl p-0 overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl sm:rounded-2xl">
          <DialogHeader className="p-6 pb-4 border-b border-border bg-muted/50">
            <DialogTitle className="text-xl font-bold">Add Question to Quiz</DialogTitle>
            <DialogDescription>Quickly inject an additional question into your assessment.</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-6">
            <div className="grid gap-3">
              <Label className="text-slate-700 dark:text-slate-300">Question Text</Label>
              <Input value={addQQuestion} onChange={(e) => setAddQQuestion(e.target.value)} placeholder="Type your question..." className="h-11 bg-muted/50" />
            </div>
            <div className="grid gap-3">
              <Label className="text-slate-700 dark:text-slate-300">Marks</Label>
              <Input type="number" min={1} value={addQMarks} onChange={(e) => setAddQMarks(Number(e.target.value))} className="w-full sm:w-1/3 h-11 bg-muted/50" />
            </div>
            <div className="grid gap-3 pt-2">
              <div className="flex justify-between items-center">
                <Label className="text-slate-700 dark:text-slate-300">Options <span className="text-slate-500 font-normal ml-1">(Click the circle to mark correct)</span></Label>
              </div>
              <div className="space-y-2 border-l-2 border-indigo-100 dark:border-indigo-900 pl-3 ml-2">
                {addQOptions.map((opt, oIdx) => (
                  <div key={oIdx} className={`flex items-center gap-2 p-2 rounded-lg transition-colors border ${opt.is_correct ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50' : 'bg-transparent border-transparent hover:bg-muted/50'}`}>
                    <div className="flex items-center justify-center shrink-0 w-8 h-8 cursor-pointer" onClick={() => setAddQOptions((prev) => prev.map((o, i) => ({ ...o, is_correct: i === oIdx })))}>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${opt.is_correct ? 'border-emerald-500 bg-emerald-500' : 'border-border bg-card'}`}>
                        {opt.is_correct && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    </div>
                    <Input value={opt.option_text} onChange={(e) => setAddQOptions((prev) => prev.map((o, i) => i === oIdx ? { ...o, option_text: e.target.value } : o))} placeholder={`Option ${oIdx + 1}`} className={`h-9 border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-offset-0 ${opt.is_correct ? 'font-medium text-emerald-900 dark:text-emerald-300 placeholder:text-emerald-700/50 dark:placeholder:text-emerald-500/50' : ''}`} />
                    {addQOptions.length > 2 && (
                      <Button variant="ghost" size="icon" onClick={() => setAddQOptions((prev) => prev.filter((_, i) => i !== oIdx))} className="h-8 w-8 text-slate-400 hover:text-rose-600 opacity-60 hover:opacity-100 transition-opacity shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setAddQOptions((prev) => [...prev, { option_text: "", is_correct: false }])} className="mt-2 h-8 text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400">
                  <Plus className="mr-1 h-3 w-3" /> Add Option
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="p-4 border-t border-border bg-muted/50">
            <Button variant="outline" onClick={() => { setOpenAddQ(false); resetAddQ(); }} className="rounded-xl">Cancel</Button>
            <Button disabled={addQuestionMutation.isPending} onClick={() => addQuestionMutation.mutate()} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md shadow-indigo-500/20 rounded-xl">
              {addQuestionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
